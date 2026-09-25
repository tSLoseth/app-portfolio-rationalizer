// Step 8: Haiku writes CIO-readable rationale text over decisions the rules engine already made.
// Usage: npm run rationale [-- --only SYS-011] [-- --force]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { assessPortfolio } from '../src/engine/assess';
import { nok } from '../src/engine/cost';
import { assumptions, portfolio } from '../src/model/data';
import type { SixR, SystemAssessment, TimeCategory } from '../src/model/types';
import { checkRationale } from './rationale-terms';

export const MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(root, 'data/rationale.json');

export interface RationaleEntry {
  text: string;
  model: string;
  time: TimeCategory;
  sixR: SixR;
  generatedAt: string;
  inputHash: string;
}

// No prompt caching: this ~350-token system prompt is far below the 4 096-token minimum cacheable prefix on Haiku 4.5.
const SYSTEM_PROMPT = `You write short explanations for an application portfolio rationalisation that is presented to a CIO.
A deterministic rules engine has already decided, for each system, its TIME category (Tolerate, Invest, Migrate or Eliminate), its 6R migration strategy (Rehost, Replatform, Refactor, Repurchase, Retire or Retain), its cost case and its place in the migration roadmap. You receive the system's attributes and the engine's results, including its rule trace, as JSON.

Rules:
- Explain the decision as given. Never change, question, soften or second-guess it, and never propose an alternative.
- Use only facts from the JSON. Do not invent numbers, dates, vendors, products, risks or benchmarks. Every number you write must appear in the JSON, in the same unit.
- Name the TIME category and the 6R strategy explicitly, using those words (for example "Migrate" and "Repurchase").
- Start with why: the decisive attributes or rule. Then say what it means in practice: cost effect and/or timing.
- Write exactly 2 or 3 sentences, at most 80 words, in plain English prose. Plain text only: no markdown, no bold, no bullet points, no headings, no field names.
- Output only the explanation.`;

const r1 = (x: number) => Math.round(x * 100) / 100;

function facts(x: SystemAssessment, nameOf: (id: string) => string) {
  const { system: s, time, sixR, cost, roadmap } = x;
  return {
    system: {
      name: s.name,
      vendor: s.vendor,
      description: s.description,
      capability: `${s.capability.l1} / ${s.capability.l2}`,
      origin: s.origin,
      type: s.type,
      hosting: s.hosting,
      techStack: s.techStack,
      platformEndOfSupportYear: s.platformEolYear,
      users: s.users,
      businessCriticality: `${s.businessCriticality} of 5`,
      dataSensitivity: s.dataSensitivity,
      residencyRequired: s.residencyRequired,
      siteBound: s.siteBound,
      sizeClass: s.sizeClass,
      integrationCount: s.integrations.length,
      ...(s.duplicateGroup ? { duplicateGroup: s.duplicateGroup, isGroupStandard: !!s.isPrimary } : {}),
    },
    time: {
      category: time.category,
      quadrantFromScores: time.quadrant,
      businessValue: `${r1(time.businessValue)} of 5`,
      technicalHealth: `${r1(time.technicalHealth)} of 5`,
      overridesApplied: time.overridesApplied,
      flags: time.flags,
      ruleTrace: time.rationale,
    },
    sixR: {
      strategy: sixR.sixR,
      flags: sixR.flags,
      ...(sixR.consolidateInto ? { consolidateInto: nameOf(sixR.consolidateInto) } : {}),
      ruleTrace: sixR.rationale,
    },
    cost: {
      baselineRunCostPerYear: nok(cost.baselineAnnual),
      targetRunCostPerYear: nok(cost.targetAnnual),
      annualSaving: nok(cost.annualSaving),
      oneOffCost: nok(cost.oneOffMigration),
      paybackYears: cost.paybackYears === null ? 'does not pay back on run cost' : r1(cost.paybackYears),
      ruleTrace: cost.rationale,
    },
    roadmap: roadmap
      ? {
          wave: roadmap.wave,
          start: roadmap.startQuarter,
          cutover: roadmap.quarter,
          durationQuarters: roadmap.durationQuarters,
          dataCenterExitScope: roadmap.dcScope,
          ruleTrace: roadmap.rationale,
        }
      : 'not scheduled: the system is retained as it is',
  };
}

const hashOf = (payload: string) => createHash('sha256').update(`${MODEL}\n${SYSTEM_PROMPT}\n${payload}`).digest('hex').slice(0, 16);

const usage = { input: 0, output: 0, calls: 0 };

async function explain(client: Anthropic, payload: string, x: SystemAssessment): Promise<string> {
  let lastProblems: string[] = [];
  let lastText = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: payload },
        ...(lastText
          ? ([
              { role: 'assistant', content: lastText },
              { role: 'user', content: `Rewrite it following the rules; problems: ${lastProblems.join('; ')}. At most 3 sentences.` },
            ] as const)
          : []),
      ],
    });
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    usage.calls++;
    const text = res.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join(' ')
      .replace(/\*\*|__/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    lastText = text;
    lastProblems = checkRationale(text, x.time.category, x.sixR.sixR);
    const sentences = text.split(/[.!?](?:\s|$)/).filter((t) => t.trim()).length;
    if (sentences > 3) lastProblems.push(`${sentences} sentences`);
    if (res.stop_reason === 'end_turn' && text && lastProblems.length === 0) return text;
    if (res.stop_reason !== 'end_turn') lastProblems.push(`stop_reason ${res.stop_reason}`);
  }
  throw new Error(`${x.system.id}: ${lastProblems.join('; ')} — last text: ${lastText}`);
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  const force = args.includes('--force');
  if (existsSync(resolve(root, '.env.local'))) process.loadEnvFile(resolve(root, '.env.local'));
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing (see .env.example)');

  const { assessments } = assessPortfolio(portfolio, assumptions);
  const nameOf = (id: string) => assessments.find((a) => a.system.id === id)?.system.name ?? id;
  if (only && !assessments.some((a) => a.system.id === only)) throw new Error(`Unknown system id ${only}`);

  const existing: Record<string, RationaleEntry> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
  const out: Record<string, RationaleEntry> = { ...existing };
  const todo = assessments
    .map((x) => ({ x, payload: JSON.stringify(facts(x, nameOf), null, 1) }))
    .map((t) => ({ ...t, hash: hashOf(t.payload) }))
    .filter(({ x, hash }) => (only ? x.system.id === only : true) && (force || existing[x.system.id]?.inputHash !== hash));
  for (const id of Object.keys(out)) if (!assessments.some((a) => a.system.id === id)) delete out[id];

  console.log(`${todo.length} of ${assessments.length} systems need (re)generation with ${MODEL}.`);
  const client = new Anthropic({ maxRetries: 6 });
  const failures: string[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const { x, payload, hash } = todo[next++]!;
      try {
        const text = await explain(client, payload, x);
        out[x.system.id] = { text, model: MODEL, time: x.time.category, sixR: x.sixR.sixR, generatedAt: new Date().toISOString(), inputHash: hash };
      } catch (e) {
        failures.push(e instanceof Anthropic.APIError ? `${x.system.id}: API ${e.status} ${e.message}` : String(e));
      }
      if (++done % 10 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n');
  // Haiku 4.5 list price: $1 / MTok input, $5 / MTok output.
  const usd = (usage.input * 1 + usage.output * 5) / 1e6;
  console.log(`Wrote ${Object.keys(sorted).length} entries to data/rationale.json.`);
  console.log(`Usage: ${usage.calls} calls, ${usage.input} input + ${usage.output} output tokens ≈ $${usd.toFixed(3)}.`);
  if (failures.length) {
    console.error(`Failed (${failures.length}):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
