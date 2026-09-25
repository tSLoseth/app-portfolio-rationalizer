import { FIELD_BY_KEY, TARGET_FIELDS, type Mapping } from './schema';

/** Lower-case ASCII words: splits camelCase, folds æøå/diacritics, drops punctuation. */
export function normalizeText(s: string): string {
  return s
    .replace(/([a-z])([A-Z][a-z0-9])/g, '$1 $2')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/[øö]/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Units, scales and yes/no hints that decorate headers without changing their meaning.
const NOISE = new Set(['nok', 'kr', 'eur', 'usd', 'mnok', 'tnok', 'knok', 'pa', 'per', 'year', 'yr', 'ar', 'aar', 'in', 'i', 'the', 'of', 'med', 'y', 'n', 'ja', 'nei', 'yes', 'no', 'scale', 'skala', '0', '1', '3', '4', '5', '10', '100', 'pct']);

export function headerTokens(header: string): string[] {
  const all = normalizeText(header).split(' ').filter(Boolean);
  const kept = all.filter((t) => !NOISE.has(t));
  return kept.length ? kept : all;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export const similarity = (a: string, b: string) => (a || b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);

export type MatchKind = 'exact' | 'synonym' | 'partial' | 'fuzzy' | 'none' | 'manual' | 'ai';

export interface HeaderMatch {
  field: string | null;
  confidence: number;
  kind: MatchKind;
  /** Which phrase matched, for the UI tooltip. */
  via?: string;
}

const phrases = new Map(
  TARGET_FIELDS.map((f) => [
    f.key,
    [...new Set([f.label, ...f.synonyms].map((p) => normalizeText(p)).filter(Boolean))].map((raw) => {
      const tokens = headerTokens(raw);
      return { raw, tokens, clean: tokens.join(' ') };
    }),
  ]),
);
const excludes = new Map(TARGET_FIELDS.map((f) => [f.key, new Set((f.exclude ?? []).map(normalizeText))]));

export function scoreHeader(header: string, fieldKey: string): { score: number; kind: MatchKind; via: string } {
  const none = { score: 0, kind: 'none' as MatchKind, via: '' };
  const raw = normalizeText(header);
  const tokens = headerTokens(header);
  const clean = tokens.join(' ');
  const ex = excludes.get(fieldKey)!;
  if (header.trim().toLowerCase() === fieldKey.toLowerCase()) return { score: 1, kind: 'exact', via: fieldKey };
  let best = none;
  for (const p of phrases.get(fieldKey) ?? []) {
    let cand = none;
    if (raw === p.raw) cand = { score: 1, kind: 'exact', via: p.raw };
    else if (clean === p.clean) cand = { score: 0.95, kind: 'synonym', via: p.raw };
    else if (tokens.some((t) => ex.has(t))) continue;
    else if (p.tokens.every((t) => tokens.includes(t)))
      cand = { score: 0.6 + 0.3 * (p.tokens.length / tokens.length), kind: 'partial', via: p.raw };
    // Norwegian compounds: "lisenskost" starts with "lisens".
    else if (p.tokens.every((t) => tokens.some((h) => h === t || (t.length >= 5 && h.startsWith(t)))))
      cand = { score: 0.55 + 0.3 * (p.tokens.length / tokens.length), kind: 'partial', via: p.raw };
    else {
      const sim = similarity(clean, p.clean);
      if (sim >= 0.8 && clean.length >= 4) cand = { score: 0.55 * sim + 0.1, kind: 'fuzzy', via: p.raw };
    }
    if (cand.score > best.score) best = cand;
  }
  return best;
}

const MIN_SCORE = 0.5;

/** Greedy one-to-one assignment by descending score; unmatched headers map to null. */
export function suggestMapping(headers: string[]): Record<string, HeaderMatch> {
  const pairs: { h: string; f: string; score: number; kind: MatchKind; via: string }[] = [];
  for (const h of headers)
    for (const f of TARGET_FIELDS) {
      const s = scoreHeader(h, f.key);
      if (s.score >= MIN_SCORE) pairs.push({ h, f: f.key, ...s });
    }
  pairs.sort((a, b) => b.score - a.score || headers.indexOf(a.h) - headers.indexOf(b.h));
  const out: Record<string, HeaderMatch> = Object.fromEntries(headers.map((h) => [h, { field: null, confidence: 0, kind: 'none' as MatchKind }]));
  const usedFields = new Set<string>();
  const usedHeaders = new Set<string>();
  for (const p of pairs) {
    if (usedFields.has(p.f) || usedHeaders.has(p.h)) continue;
    usedFields.add(p.f);
    usedHeaders.add(p.h);
    out[p.h] = { field: p.f, confidence: Math.round(p.score * 100) / 100, kind: p.kind, via: p.via };
  }
  return out;
}

export const toMapping = (m: Record<string, HeaderMatch>): Mapping => Object.fromEntries(Object.entries(m).map(([h, x]) => [h, x.field]));

/**
 * Reads a saved mapping file: {mapping: {header: field | {field}}} (as written by scripts/map-columns.ts) or a flat
 * {header: field}. Unknown fields and headers not in the CSV are dropped and reported.
 */
export function readMappingJson(json: unknown, headers: string[]): { matches: Record<string, HeaderMatch>; dropped: string[] } {
  const obj = (json && typeof json === 'object' && 'mapping' in json ? (json as { mapping: unknown }).mapping : json) as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') throw new Error('Mapping JSON must be an object of {column: field}.');
  const dropped: string[] = [];
  const matches: Record<string, HeaderMatch> = Object.fromEntries(headers.map((h) => [h, { field: null, confidence: 0, kind: 'none' as MatchKind }]));
  for (const [header, v] of Object.entries(obj)) {
    const field = typeof v === 'string' || v === null ? v : v && typeof v === 'object' && 'field' in v ? (v as { field: unknown }).field : undefined;
    const conf = v && typeof v === 'object' && 'confidence' in v ? Number((v as { confidence: unknown }).confidence) : 1;
    if (!headers.includes(header)) {
      dropped.push(`column "${header}" is not in this file`);
      continue;
    }
    if (field === null) continue;
    if (typeof field !== 'string' || !FIELD_BY_KEY.has(field)) {
      dropped.push(`"${header}" → unknown field ${String(field)}`);
      continue;
    }
    matches[header] = { field, confidence: Number.isFinite(conf) ? conf : 1, kind: 'ai' };
  }
  return { matches, dropped };
}
