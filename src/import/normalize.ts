import type { DataSensitivity, Hosting, Origin, SizeClass, SystemType } from '../model/types';
import { normalizeText } from './mapping';

const EMPTY = new Set(['', '-', '--', 'n a', 'na', 'none', 'null', 'unknown', 'ukjent', 'tbd', 'ingen', 'x', '?']);
export const isBlank = (v: string | undefined) => v === undefined || EMPTY.has(normalizeText(v));

const words = (v: string) => ` ${normalizeText(v)} `;
const has = (v: string, ...needles: string[]) => needles.some((n) => words(v).includes(` ${n} `));
const hasPrefix = (v: string, ...prefixes: string[]) => normalizeText(v).split(' ').some((t) => prefixes.some((p) => t.startsWith(p)));

/**
 * NOK amounts as people type them: "1 250 000", "1.250.000", "1,250,000", "kr 95 000,-", "2,1 mill", "380k", "1.2 MNOK".
 * A lone separator followed by exactly three digits is a thousands separator; otherwise it is the decimal mark.
 */
export function parseAmount(input: string): number | null {
  if (isBlank(input)) return null;
  let s = input
    .toLowerCase()
    .replace(/[\s  ']/g, '')
    .replace(/(?<![mtk])(nok|kr|eur|usd)\.?/g, '')
    .replace(/,-$|\.-$/, '');
  const negative = /^[-−(]/.test(s);
  let mult = 1;
  const suffix = s.match(/(mrd|bn|mnok|mill(?:ioner|ion)?|mln|m|tnok|knok|k|tusen)\.?$/);
  if (suffix) {
    const u = suffix[1]!;
    mult = u === 'mrd' || u === 'bn' ? 1e9 : u.startsWith('m') ? 1e6 : 1e3;
    s = s.slice(0, suffix.index);
  }
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.replace(dec === '.' ? /,/g : /\./g, '').replace(',', '.');
  } else {
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : '';
    if (sep) {
      const parts = s.split(sep);
      const thousands = parts.length > 2 || (parts[1]!.length === 3 && mult === 1);
      s = thousands ? parts.join('') : `${parts.slice(0, -1).join('')}.${parts.at(-1)}`;
    }
  }
  const n = Number(s) * mult;
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/** First plain number in a cell: "ca. 300" → 300, "1 200" → 1200, "0,5" → 0.5. */
export function parseNumber(input: string): number | null {
  if (isBlank(input)) return null;
  const m = input.replace(/[  ]/g, ' ').match(/-?\d+(?:[ .,]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/);
  return m ? parseAmount(m[0]) : null;
}

/** A 4-digit year anywhere in the cell: "2027", "Q3 2025", "31.12.2028", "des. 2026". */
export function parseYear(input: string): number | null {
  if (isBlank(input)) return null;
  const m = input.match(/(?:19|20)\d{2}/);
  if (m) return Number(m[0]);
  const short = input.trim().match(/^(?:\d{1,2}[./-])?(\d{1,2})[./-](\d{2})$/);
  return short ? 2000 + Number(short[2]) : null;
}

const WORD_SCORE: [string[], number][] = [
  [['very high', 'svaert hoy', 'mission critical', 'forretningskritisk', 'kritisk', 'critical', 'tier 1', 'tier1', 'excellent', 'utmerket', 'a'], 5],
  [['high', 'hoy', 'hy', 'important', 'viktig', 'good', 'god', 'tier 2', 'b'], 4],
  [['medium', 'middels', 'moderate', 'moderat', 'normal', 'ok', 'average', 'tier 3', 'c'], 3],
  [['low', 'lav', 'poor', 'darlig', 'weak', 'svak', 'tier 4', 'd'], 2],
  [['very low', 'svaert lav', 'minimal', 'negligible', 'ubetydelig', 'very poor', 'e'], 1],
];

/** Raw score before rescaling: numbers stay numbers, words map onto 1–5. */
export function parseScoreRaw(input: string): { value: number; numeric: boolean } | null {
  if (isBlank(input)) return null;
  const n = normalizeText(input);
  for (const [phrases, score] of WORD_SCORE) if (phrases.includes(n)) return { value: score, numeric: false };
  const num = parseNumber(input);
  return num === null ? null : { value: num, numeric: true };
}

export type ScoreScale = 5 | 10 | 100;

/** Scale of a score column, from its largest numeric value. */
export function detectScale(values: number[]): ScoreScale {
  const max = Math.max(0, ...values);
  return max > 10 ? 100 : max > 5 ? 10 : 5;
}

export function rescale(value: number, scale: ScoreScale): number {
  const v = scale === 5 ? value : scale === 10 ? 1 + ((value - 1) * 4) / 9 : 1 + (value / 100) * 4;
  return Math.min(5, Math.max(1, Math.round(v)));
}

export interface Parsed<T> {
  value: T;
  /** The cell had something we could not read; build.ts records it. */
  unparsed?: boolean;
}

export function parseHosting(v: string): { hosting: Hosting; siteBound?: boolean } | null {
  if (isBlank(v)) return null;
  if (hasPrefix(v, 'saas') || has(v, 'software as a service', 'cloud service', 'skytjeneste', 'vendor hosted', 'leverandorhostet', 'm365', 'office 365', 'microsoft 365'))
    return { hosting: 'saas' };
  if (has(v, 'plant', 'site', 'fabrikk', 'factory', 'ot', 'edge', 'lokalt', 'local', 'shop floor', 'verksted'))
    return { hosting: 'on_prem_dc', siteBound: true };
  if (has(v, 'private cloud', 'privat sky', 'hosted', 'hosting partner', 'outsourced', 'utsatt', 'managed hosting', 'colo', 'colocation') || hasPrefix(v, 'evry', 'tietoevry', 'atea', 'basefarm', 'iver', 'ipnett', 'privat'))
    return { hosting: 'private_cloud' };
  if (hasPrefix(v, 'azure', 'aws', 'gcp', 'google', 'amazon', 'iaas', 'paas', 'public', 'offentlig', 'oci', 'kubernetes', 'aks', 'eks') || has(v, 'cloud', 'sky', 'public cloud'))
    return { hosting: 'public_cloud' };
  if (hasPrefix(v, 'on prem', 'onprem', 'on premise', 'datasenter', 'datacenter', 'dc', 'egen', 'intern', 'server', 'kjeller', 'in house', 'inhouse', 'vmware') || has(v, 'on prem', 'on premise', 'on premises', 'own dc', 'eget datasenter', 'data center', 'data centre'))
    return { hosting: 'on_prem_dc' };
  return null;
}

export function parseType(v: string): SystemType | null {
  if (isBlank(v)) return null;
  if (hasPrefix(v, 'saas') || has(v, 'subscription', 'abonnement', 'cloud service')) return 'saas';
  if (hasPrefix(v, 'custom', 'egenutvikl', 'bespoke', 'in house', 'inhouse', 'homegrown', 'home', 'skreddersydd', 'internal', 'intern', 'build', 'egen') || has(v, 'in house', 'self built', 'selvutviklet'))
    return 'custom';
  if (hasPrefix(v, 'cots', 'standard', 'hyllevare', 'package', 'pakke', 'off the shelf', 'commercial', 'kommersiell', 'lisens', 'licensed', 'buy', 'kjopt', 'product', 'produkt', 'erp'))
    return 'cots';
  return null;
}

export function parseSensitivity(v: string): DataSensitivity | null {
  if (isBlank(v)) return null;
  if (/^(nei|no|n|ingen|none|false|ikke)\b/.test(normalizeText(v))) return 'internal';
  if (has(v, 'special', 'special category', 'saerlig', 'saerlige', 'sensitiv', 'sensitive', 'helse', 'health', 'strengt', 'strictly', 'art 9', 'fodselsnummer', 'biometric')) return 'special_category';
  if (hasPrefix(v, 'person', 'pii', 'gdpr') || has(v, 'ja', 'yes', 'y', 'true', 'confidential', 'konfidensiell', 'fortrolig', 'restricted', 'begrenset')) return 'personal';
  if (hasPrefix(v, 'public', 'offentlig', 'apen', 'open')) return 'public';
  if (hasPrefix(v, 'intern', 'nei', 'no', 'false', 'ingen', 'none', 'lav', 'low')) return 'internal';
  return null;
}

export function parseOrigin(v: string): Origin | null {
  if (isBlank(v)) return null;
  if (has(v, 'shadow', 'skygge', 'shadow it', 'skygge it', 'business owned', 'business managed', 'forretningsstyrt', 'ikke it', 'not it', 'lokal') || hasPrefix(v, 'skygge'))
    return 'shadow_it';
  if (hasPrefix(v, 'acquired', 'oppkjop', 'kjopt', 'acq', 'merger', 'fusjon', 'legacy entity')) return 'acquired_A';
  if (hasPrefix(v, 'core', 'kjerne', 'group', 'konsern', 'hq', 'it', 'sentral', 'central')) return 'core';
  return null;
}

export function parseBool(v: string): boolean | null {
  if (isBlank(v)) return null;
  const n = normalizeText(v);
  if (/^(ja|yes|y|j|true|sann|1|x|primary|primaer|standard|required|pakrevd|kreves)\b/.test(n)) return true;
  if (/^(nei|no|n|false|usann|0|not|ikke)\b/.test(n)) return false;
  return null;
}

export function parseSize(v: string): SizeClass | null {
  if (isBlank(v)) return null;
  const n = normalizeText(v);
  if (/^(xl|x large|extra large|svaert stor|very large|enterprise)\b/.test(n)) return 'XL';
  if (/^(l|large|stor|big|high|hoy)\b/.test(n)) return 'L';
  if (/^(m|medium|middels|mid)\b/.test(n)) return 'M';
  if (/^(s|xs|small|liten|low|lav)\b/.test(n)) return 'S';
  return null;
}

export function splitList(v: string): string[] {
  if (isBlank(v)) return [];
  return v
    .split(/[;|\n]|,(?!\d)|\s\+\s/)
    .map((x) => x.trim())
    .filter((x) => x && !isBlank(x));
}
