// Step 9 (optional AI layer): Haiku proposes a column mapping for a messy CSV; the user confirms it in the Import tab.
// Usage: npm run map-columns -- path/to/inventory.csv   → writes path/to/inventory.csv.mapping.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { decodeBytes, parseCsv } from '../src/import/csv';
import { suggestMapping } from '../src/import/mapping';
import { FIELD_BY_KEY, TARGET_FIELDS, validateMapping, type Mapping } from '../src/import/schema';

export const MODEL = 'claude-haiku-4-5-20251001';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SYSTEM_PROMPT = `You map the columns of an application-inventory CSV (exported from a CMDB or a spreadsheet, often in Norwegian) onto a fixed target schema.
Rule: the model proposes, the user confirms. Your mapping is shown to a person who reviews every row before anything runs, so be honest about uncertainty.

Rules:
- Map each source column to at most one target field key from the schema, or to null if nothing fits (comments, owners' names, free notes).
- Use each target field at most once. If two columns compete for a field, pick the better one and set the other to null.
- Judge from both the header text and the sample values (units, scales, formats).
- "supportFte" is an internal support cost in NOK; "supportFteCount" is a number of FTEs (typically 0.1–10).
- confidence is 0–1: how sure you are the mapping is right.
- Output only JSON of the form {"mapping": {"<source column>": {"field": "<key>" | null, "confidence": <number>, "reason": "<max 12 words>"}}} with every source column present exactly as written.`;

const schemaText = TARGET_FIELDS.map((f) => `- ${f.key}: ${f.label} (${f.kind}; e.g. ${f.example})`).join('\n');

interface Proposal {
  field: string | null;
  confidence: number;
  reason: string;
}

function parseProposal(text: string, headers: string[]): { mapping: Record<string, Proposal>; problems: string[] } {
  const problems: string[] = [];
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { mapping: {}, problems: ['output is not valid JSON'] };
  }
  const m = (raw as { mapping?: Record<string, Partial<Proposal>> }).mapping ?? {};
  const mapping: Record<string, Proposal> = {};
  for (const h of headers) {
    const p = m[h];
    if (!p) {
      problems.push(`column "${h}" missing`);
      continue;
    }
    const field = p.field ?? null;
    if (field !== null && !FIELD_BY_KEY.has(field)) problems.push(`"${h}" → unknown field ${field}`);
    mapping[h] = {
      field: field !== null && FIELD_BY_KEY.has(field) ? field : null,
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
      reason: String(p.reason ?? ''),
    };
  }
  for (const k of Object.keys(m)) if (!headers.includes(k)) problems.push(`unknown column "${k}"`);
  const flat: Mapping = Object.fromEntries(Object.entries(mapping).map(([h, p]) => [h, p.field]));
  problems.push(...validateMapping(flat).filter((i) => i.level === 'error').map((i) => i.text));
  return { mapping, problems };
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run map-columns -- <file.csv>');
  const path = resolve(process.cwd(), file);
  if (existsSync(resolve(root, '.env.local'))) process.loadEnvFile(resolve(root, '.env.local'));
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing (see .env.example)');

  const table = parseCsv(decodeBytes(readFileSync(path)).text);
  const sample = [table.headers, ...table.rows.slice(0, 5)];
  const payload =
    `Target schema (field keys):\n${schemaText}\n\n` +
    `CSV headers and the first ${sample.length - 1} rows, as JSON arrays:\n${sample.map((r) => JSON.stringify(r)).join('\n')}`;

  const client = new Anthropic({ maxRetries: 4 });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: payload }];
  let result: ReturnType<typeof parseProposal> = { mapping: {}, problems: ['not run'] };
  const usage = { input: 0, output: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 4000, temperature: 0, system: SYSTEM_PROMPT, messages });
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    result = parseProposal(text, table.headers);
    if (!result.problems.length && res.stop_reason === 'end_turn') break;
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Fix these problems and output the full JSON again: ${result.problems.join('; ')}` });
  }

  // A field may still be proposed twice if the retry failed: keep the most confident claim.
  const byField = new Map<string, string>();
  for (const [h, p] of Object.entries(result.mapping)) {
    if (!p.field) continue;
    const other = byField.get(p.field);
    if (other && result.mapping[other]!.confidence >= p.confidence) p.field = null;
    else {
      if (other) result.mapping[other]!.field = null;
      byField.set(p.field, h);
    }
  }

  const rules = suggestMapping(table.headers);
  const out = {
    source: basename(path),
    model: MODEL,
    generatedAt: new Date().toISOString(),
    note: 'Proposed by a model; review and confirm in the Import tab before the engine runs.',
    mapping: result.mapping,
  };
  const outPath = `${path}.mapping.json`;
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

  console.log(`${'Column'.padEnd(28)} ${'AI proposal'.padEnd(22)} conf  rules`);
  let agree = 0;
  for (const h of table.headers) {
    const p = result.mapping[h];
    const r = rules[h]?.field ?? null;
    if ((p?.field ?? null) === r) agree++;
    console.log(`${h.padEnd(28)} ${String(p?.field ?? '—').padEnd(22)} ${(p?.confidence ?? 0).toFixed(2)}  ${r ?? '—'}${(p?.field ?? null) === r ? '' : '  ≠'}`);
  }
  console.log(`AI and header rules agree on ${agree}/${table.headers.length} columns.`);
  if (result.problems.length) console.warn(`Remaining problems: ${result.problems.join('; ')}`);
  console.log(`Wrote ${outPath}. Usage: ${usage.input} input + ${usage.output} output tokens ≈ $${((usage.input + usage.output * 5) / 1e6).toFixed(4)}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
