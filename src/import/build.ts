import type {
  AnnualCost,
  Assumptions,
  CapabilityDef,
  CapabilityL1,
  DataSensitivity,
  Hosting,
  Portfolio,
  PortfolioMeta,
  SizeClass,
  System,
  SystemType,
} from '../model/types';
import { matchL1, matchL2 } from './capabilities';
import type { CsvTable } from './csv';
import { normalizeText, similarity } from './mapping';
import {
  detectScale,
  isBlank,
  parseAmount,
  parseBool,
  parseHosting,
  parseNumber,
  parseOrigin,
  parseScoreRaw,
  parseSensitivity,
  parseSize,
  parseType,
  parseYear,
  rescale,
  splitList,
  type ScoreScale,
} from './normalize';
import { FIELD_BY_KEY, type Mapping } from './schema';

export interface ImportReport {
  fileName: string;
  rowsRead: number;
  systems: number;
  skipped: { row: number; reason: string }[];
  /** Systems per field whose value was assumed (column missing, blank or unreadable). */
  defaulted: Record<string, number>;
  unreadable: { row: number; field: string; value: string }[];
  rescaled: { field: string; header: string; scale: ScoreScale }[];
  capabilityMatches: { exact: number; keyword: number; fuzzy: number; created: number };
  newCapabilities: { l1: string; l2: string; systems: number }[];
  unresolvedIntegrations: { system: string; ref: string }[];
  duplicateGroups: number;
  primariesAssumed: string[];
  /** Field keys assumed per system id (plus 'costSplit' and 'capability' for derived values), for the preview. */
  assumedBySystem: Record<string, string[]>;
}

export interface BuildOptions {
  fileName: string;
  catalog: CapabilityDef[];
  assumptions: Assumptions;
  baseMeta: PortfolioMeta;
}

const SCORE_FIELDS = [
  'businessCriticality', 'businessFit', 'functionalCoverage', 'userSatisfaction', 'strategicRelevance',
  'technicalFit', 'supportability', 'security', 'scalability', 'documentation', 'eolRisk',
] as const;

const COST_PROFILE: Record<SystemType, Record<keyof AnnualCost, number>> = {
  saas: { license: 0.8, infra: 0, supportFte: 0.15, vendorSupport: 0.05 },
  cots: { license: 0.35, infra: 0.25, supportFte: 0.25, vendorSupport: 0.15 },
  custom: { license: 0.05, infra: 0.35, supportFte: 0.5, vendorSupport: 0.1 },
};
const COMPONENT_LABEL: Record<keyof AnnualCost, string> = { license: 'licence', infra: 'infra', supportFte: 'internal support', vendorSupport: 'vendor support' };

const sizeFromCost = (nok: number): SizeClass => (nok < 1e6 ? 'S' : nok < 5e6 ? 'M' : nok < 15e6 ? 'L' : 'XL');

const eolRiskFromYears = (years: number): number => (years < 0 ? 1 : years < 2 ? 2 : years < 4 ? 3 : years < 7 ? 4 : 5);

const VENDOR_MANAGED = /vendor|leverandør|leverandor|saas|evergreen|managed|n\/a saas|continuous/i;
const IN_HOUSE = /in-house|in house|inhouse|egenutvikl|intern|internal|own|egen/i;

const label = (key: string) => FIELD_BY_KEY.get(key)?.label ?? key;
const fmtNok = (x: number) => `NOK ${Math.round(x).toLocaleString('en-US')}`;
const round1000 = (x: number) => Math.round(x / 1000) * 1000;

/**
 * Turns a mapped CSV into a Portfolio the engine can assess. Every value that is not read straight from the file
 * is recorded on the system (importNotes) and counted in the report, so the audit trail separates facts from assumptions.
 */
export function buildPortfolio(table: CsvTable, mapping: Mapping, opts: BuildOptions): { portfolio: Portfolio; report: ImportReport } {
  const refYear = opts.assumptions.referenceYear.value;
  const fteCost = opts.assumptions.cost.fteLoadedCostNok.value;
  const col = new Map<string, number>();
  for (const [header, key] of Object.entries(mapping)) {
    const i = table.headers.indexOf(header);
    if (key && i >= 0 && !col.has(key)) col.set(key, i);
  }
  const headerOf = (key: string) => table.headers[col.get(key)!]!;

  const report: ImportReport = {
    fileName: opts.fileName,
    rowsRead: table.rows.length,
    systems: 0,
    skipped: [],
    defaulted: {},
    unreadable: [],
    rescaled: [],
    capabilityMatches: { exact: 0, keyword: 0, fuzzy: 0, created: 0 },
    newCapabilities: [],
    unresolvedIntegrations: [],
    duplicateGroups: 0,
    primariesAssumed: [],
    assumedBySystem: {},
  };

  const scales = new Map<string, ScoreScale>();
  for (const f of SCORE_FIELDS) {
    if (!col.has(f)) continue;
    const nums = table.rows.flatMap((r) => {
      const s = parseScoreRaw(r[col.get(f)!] ?? '');
      return s?.numeric ? [s.value] : [];
    });
    const scale = detectScale(nums);
    scales.set(f, scale);
    if (scale !== 5) report.rescaled.push({ field: f, header: headerOf(f), scale });
  }

  const catalogById = new Map(opts.catalog.map((c) => [c.id, c]));
  const usedCaps = new Map<string, CapabilityDef>();
  const newCaps = new Map<string, CapabilityDef>();
  const newCapCount = new Map<string, number>();

  interface Draft {
    system: System;
    row: number;
    externalId?: string;
    integrationRefs: string[];
    primaryCell: boolean | null;
    notes: string[];
  }
  const drafts: Draft[] = [];

  table.rows.forEach((cells, idx) => {
    const rowNo = idx + 2;
    const cell = (key: string) => (col.has(key) ? (cells[col.get(key)!] ?? '').trim() : undefined);
    const notes: string[] = [];
    const defaulted: string[] = [];
    const assumedKeys: string[] = [];
    const count = (key: string) => {
      report.defaulted[key] = (report.defaulted[key] ?? 0) + 1;
      assumedKeys.push(key);
    };
    const assume = (key: string, value: string) => {
      count(key);
      const raw = cell(key);
      if (raw !== undefined && !isBlank(raw)) {
        report.unreadable.push({ row: rowNo, field: key, value: raw });
        notes.push(`Could not read ${label(key)} "${raw}"; assumed ${value}.`);
      } else defaulted.push(`${label(key)} = ${value}`);
    };
    const read = <T,>(key: string, parse: (v: string) => T | null): T | null => {
      const raw = cell(key);
      return raw === undefined ? null : parse(raw);
    };

    const name = cell('name');
    if (!name || isBlank(name)) {
      report.skipped.push({ row: rowNo, reason: 'no system name' });
      return;
    }

    const vendor = cell('vendor');
    const hostingP = read('hosting', parseHosting);
    let type = read('type', parseType);
    if (!type) {
      type = hostingP?.hosting === 'saas' ? 'saas' : IN_HOUSE.test(`${vendor ?? ''} ${name}`) ? 'custom' : 'cots';
      assume('type', `${type} (${hostingP?.hosting === 'saas' ? 'SaaS hosting' : type === 'custom' ? 'in-house vendor' : 'packaged software'})`);
    }
    let hosting: Hosting | undefined = hostingP?.hosting;
    if (!hosting) {
      hosting = type === 'saas' ? 'saas' : 'on_prem_dc';
      assume('hosting', hosting === 'saas' ? 'saas (type is SaaS)' : 'on_prem_dc (conservative: counted in data-center scope)');
    }
    const siteCell = read('siteBound', parseBool);
    const siteBound = siteCell ?? hostingP?.siteBound ?? false;

    const eolRaw = cell('platformEolYear');
    let platformEolYear = eolRaw === undefined ? null : parseYear(eolRaw);
    if (platformEolYear === null) {
      const vendorManaged = hosting === 'saas' || (eolRaw !== undefined && VENDOR_MANAGED.test(eolRaw));
      if (!vendorManaged) assume('platformEolYear', 'unknown, so no EOL penalty (verify)');
      platformEolYear = null;
    }
    const lastMajorUpgrade = read('lastMajorUpgrade', parseYear) ?? (assume('lastMajorUpgrade', String(refYear)), refYear);
    const users = Math.round(read('users', parseNumber) ?? (assume('users', '0 (unknown)'), 0));

    const score = (key: (typeof SCORE_FIELDS)[number]): number | null => {
      const s = read(key, parseScoreRaw);
      if (!s) return null;
      return s.numeric ? rescale(s.value, scales.get(key) ?? 5) : s.value;
    };
    const criticality = score('businessCriticality') ?? (assume('businessCriticality', '3 (neutral)'), 3);
    const bfAll = score('businessFit');
    const tfAll = score('technicalFit');
    const sub = (key: (typeof SCORE_FIELDS)[number], overall: number | null, overallKey: string, derived?: { value: number; why: string }) => {
      const v = score(key);
      if (v !== null) return v;
      if (derived) {
        notes.push(`${label(key)} ${derived.value} derived from ${derived.why}.`);
        count(key);
        return derived.value;
      }
      if (overall !== null) {
        count(key);
        defaulted.push(`${label(key)} = ${overall} (overall ${overallKey === 'businessFit' ? 'business' : 'technical'} fit)`);
        return overall;
      }
      assume(key, '3 (neutral)');
      return 3;
    };
    const yearsToEol = platformEolYear === null ? null : platformEolYear - refYear;
    const businessFit = {
      functionalCoverage: sub('functionalCoverage', bfAll, 'businessFit'),
      userSatisfaction: sub('userSatisfaction', bfAll, 'businessFit'),
      strategicRelevance: sub('strategicRelevance', bfAll, 'businessFit'),
    };
    const technicalFit = {
      supportability: sub('supportability', tfAll, 'technicalFit'),
      security: sub('security', tfAll, 'technicalFit'),
      scalability: sub('scalability', tfAll, 'technicalFit'),
      documentation: sub('documentation', tfAll, 'technicalFit'),
      eolRisk: sub(
        'eolRisk',
        tfAll,
        'technicalFit',
        yearsToEol !== null
          ? { value: eolRiskFromYears(yearsToEol), why: `platform EOL ${platformEolYear}` }
          : hosting === 'saas'
            ? { value: 5, why: 'vendor-managed SaaS platform' }
            : undefined,
      ),
    };

    let sensitivity: DataSensitivity | null = read('dataSensitivity', parseSensitivity);
    if (!sensitivity) {
      sensitivity = 'internal';
      assume('dataSensitivity', 'internal');
    }
    let residencyRequired = read('residencyRequired', parseBool);
    if (residencyRequired === null) {
      residencyRequired = sensitivity === 'special_category';
      if (residencyRequired) notes.push('Residency required assumed because the data is special-category.');
    }

    let origin = read('origin', parseOrigin);
    if (!origin) {
      origin = 'core';
      assume('origin', 'core');
    }

    // Cost: explicit components win; a total fills the missing components by a type profile.
    const comps: Record<keyof AnnualCost, number | null> = {
      license: read('license', parseAmount),
      infra: read('infra', parseAmount),
      supportFte: read('supportFte', parseAmount),
      vendorSupport: read('vendorSupport', parseAmount),
    };
    if (comps.supportFte === null) {
      const fte = read('supportFteCount', parseNumber);
      if (fte !== null) {
        comps.supportFte = fte * fteCost;
        notes.push(`Internal support cost ${fmtNok(comps.supportFte)} = ${fte} FTE × ${fmtNok(fteCost)} loaded cost.`);
      }
    }
    const total = read('totalCost', parseAmount);
    const missing = (Object.keys(comps) as (keyof AnnualCost)[]).filter((k) => comps[k] === null);
    const known = (Object.keys(comps) as (keyof AnnualCost)[]).reduce((t, k) => t + (comps[k] ?? 0), 0);
    const annualCost = {} as AnnualCost;
    if (total !== null && missing.length) {
      const profile = { ...COST_PROFILE[type], ...(hosting === 'saas' ? { infra: 0 } : {}) };
      const weight = missing.reduce((t, k) => t + profile[k], 0);
      const share = (k: keyof AnnualCost) => (weight > 0 ? profile[k] / weight : 1 / missing.length);
      const remainder = Math.max(0, total - known);
      for (const k of Object.keys(comps) as (keyof AnnualCost)[]) {
        const given = comps[k];
        annualCost[k] = given !== null ? Math.round(given) : round1000(remainder * share(k));
      }
      notes.push(
        `Annual cost ${fmtNok(total)}${known ? ` minus given components ${fmtNok(known)}` : ''} split into ${missing.map((k) => COMPONENT_LABEL[k]).join(', ')} ` +
          `using the ${type}${hosting === 'saas' ? ' (SaaS)' : ''} profile (${missing.map((k) => `${Math.round(share(k) * 100)}%`).join(' / ')}); the split drives the 6R cost factors.`,
      );
      if (known > total) notes.push(`Given components (${fmtNok(known)}) exceed the total ${fmtNok(total)}; components used, total ignored.`);
      count('costSplit');
    } else {
      for (const k of Object.keys(comps) as (keyof AnnualCost)[]) annualCost[k] = Math.round(comps[k] ?? 0);
      if (total !== null && Math.abs(total - known) > Math.max(1000, total * 0.01))
        notes.push(`Components sum to ${fmtNok(known)} but the total column says ${fmtNok(total)}; components used.`);
      if (known === 0 && total === null) {
        notes.push('No cost given: run cost assumed 0 (verify).');
        count('totalCost');
      } else if (missing.length && missing.length < 4)
        defaulted.push(`${missing.map((k) => COMPONENT_LABEL[k]).join(', ')} cost = 0 (not given)`);
    }
    const baseline = Object.values(annualCost).reduce((t, x) => t + x, 0);

    let sizeClass = read('sizeClass', parseSize);
    if (!sizeClass) {
      sizeClass = sizeFromCost(baseline);
      assume('sizeClass', `${sizeClass} (from ${fmtNok(baseline)} run cost)`);
    }

    // Capability: place on the reference map, else create a new capability.
    const l1Raw = cell('capabilityL1') ?? '';
    const l2Raw = cell('capabilityL2') ?? '';
    const l1 = isBlank(l1Raw) ? null : matchL1(l1Raw);
    const m = isBlank(l2Raw) ? null : matchL2(l2Raw, l1, opts.catalog);
    let capDef: CapabilityDef;
    if (m) {
      capDef = m.def;
      report.capabilityMatches[m.how]++;
      if (m.how !== 'exact') notes.push(`Capability "${l2Raw}" placed on ${capDef.l1} / ${capDef.l2} (${m.how} match).`);
      if (l1 && l1 !== capDef.l1) notes.push(`Owner domain "${l1Raw}" differs from the capability's domain ${capDef.l1}; the capability wins.`);
    } else {
      const newL1 = (l1 ?? (isBlank(l1Raw) ? 'Unclassified' : l1Raw.trim())) as CapabilityL1;
      const newL2 = isBlank(l2Raw) ? (isBlank(l1Raw) ? 'Unclassified' : 'General') : l2Raw.trim();
      const key = `${normalizeText(newL1)}|${normalizeText(newL2)}`;
      if (!newCaps.has(key))
        newCaps.set(key, { id: `NEW-${String(newCaps.size + 1).padStart(2, '0')}`, l1: newL1, l2: newL2, saasAlternative: true });
      capDef = newCaps.get(key)!;
      newCapCount.set(key, (newCapCount.get(key) ?? 0) + 1);
      report.capabilityMatches.created++;
      assumedKeys.push('capability');
      notes.push(
        `Capability "${[l1Raw, l2Raw].filter((x) => !isBlank(x)).join(' / ') || 'none given'}" is not on the reference map: new capability ${newL1} / ${newL2}, ` +
          `SaaS alternative assumed to exist (verify, it decides Repurchase vs Replatform).`,
      );
    }
    if (catalogById.has(capDef.id)) usedCaps.set(capDef.id, capDef);

    const techStack = splitList(cell('techStack') ?? '');
    if (!techStack.length) assume('techStack', 'Unknown');

    if (defaulted.length) notes.unshift(`Not in the inventory, assumed: ${defaulted.join('; ')}.`);

    const system: System = {
      id: `IMP-${String(drafts.length + 1).padStart(3, '0')}`,
      name: name.trim(),
      vendor: vendor && !isBlank(vendor) ? vendor : 'Unknown',
      description: cell('description') ?? '',
      capability: { l1: capDef.l1, l2: capDef.l2 },
      origin,
      type,
      hosting,
      techStack: techStack.length ? techStack : ['Unknown'],
      platformEolYear,
      lastMajorUpgrade,
      users,
      businessCriticality: criticality,
      dataSensitivity: sensitivity,
      residencyRequired,
      siteBound,
      businessFit,
      technicalFit,
      annualCost,
      integrations: [],
      sizeClass,
    };
    report.assumedBySystem[system.id] = assumedKeys;
    const ext = cell('externalId');
    drafts.push({
      system,
      row: rowNo,
      ...(ext && !isBlank(ext) ? { externalId: ext } : {}),
      integrationRefs: splitList(cell('integrations') ?? ''),
      primaryCell: read('isPrimary', parseBool),
      notes,
    });
    const dup = cell('duplicateGroup');
    if (dup && !isBlank(dup)) system.duplicateGroup = `dup-${normalizeText(dup).replace(/ /g, '-')}`;
  });

  // Integrations: resolve by source id, then exact name, then close name.
  const byExt = new Map(drafts.filter((d) => d.externalId).map((d) => [normalizeText(d.externalId!), d.system.id]));
  const byName = new Map(drafts.map((d) => [normalizeText(d.system.name), d.system.id]));
  for (const d of drafts) {
    const ids = new Set<string>();
    for (const ref of d.integrationRefs) {
      const n = normalizeText(ref);
      let id = byExt.get(n) ?? byName.get(n);
      if (!id) {
        const close = drafts
          .map((o) => ({ id: o.system.id, n: normalizeText(o.system.name) }))
          .filter((o) => o.n.startsWith(`${n} `) || similarity(o.n, n) >= 0.85);
        if (close.length === 1) id = close[0]!.id;
      }
      if (id && id !== d.system.id) ids.add(id);
      else if (!id) {
        report.unresolvedIntegrations.push({ system: d.system.name, ref });
        d.notes.push(`Integration "${ref}" does not match any system in the file; ignored.`);
      }
    }
    d.system.integrations = [...ids];
  }

  // Duplicate groups: drop singletons, ensure exactly one primary.
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) if (d.system.duplicateGroup) groups.set(d.system.duplicateGroup, [...(groups.get(d.system.duplicateGroup) ?? []), d]);
  const rank = (d: Draft) => [d.system.businessCriticality, d.system.users, -d.row];
  const better = (a: Draft, b: Draft) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! > y[i]! ? a : b;
    return a;
  };
  for (const [g, members] of groups) {
    if (members.length < 2) {
      delete members[0]!.system.duplicateGroup;
      members[0]!.notes.push(`Only system in overlap group "${g.slice(4)}"; not treated as a duplicate.`);
      continue;
    }
    report.duplicateGroups++;
    const marked = members.filter((d) => d.primaryCell === true);
    const primary = (marked.length ? marked : members).reduce(better);
    if (marked.length !== 1) {
      report.primariesAssumed.push(g);
      primary.notes.push(
        marked.length > 1
          ? `Several systems in group ${g} are marked primary; ${primary.system.name} kept (highest criticality, then users).`
          : `Group standard for ${g} not given; ${primary.system.name} assumed (highest criticality, then users).`,
      );
    }
    for (const d of members) d.system.isPrimary = d === primary;
  }

  for (const d of drafts) if (d.notes.length) d.system.importNotes = d.notes;
  report.systems = drafts.length;
  report.newCapabilities = [...newCaps.entries()].map(([k, c]) => ({ l1: c.l1, l2: c.l2, systems: newCapCount.get(k) ?? 0 }));

  const capabilities = [
    ...opts.catalog.filter((c) => usedCaps.has(c.id)),
    ...newCaps.values(),
  ];
  const portfolio: Portfolio = {
    meta: {
      ...opts.baseMeta,
      company: opts.fileName,
      description: `Imported inventory (${drafts.length} systems) from ${opts.fileName}.`,
      employees: 0,
      referenceYear: refYear,
      acquisitions: [],
      seed: 0,
      generator: `csv-import:${opts.fileName}`,
      originLabels: { core: 'Core IT', acquired_A: 'Acquired', acquired_B: 'Acquired', shadow_it: 'Shadow IT' },
      imported: { fileName: opts.fileName, rows: table.rows.length },
    },
    capabilities,
    systems: drafts.map((d) => d.system),
  };
  return { portfolio, report };
}
