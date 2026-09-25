import { describe, expect, it } from 'vitest';
import { assessPortfolio } from '../engine/assess';
import { assumptions, portfolio as demo } from '../model/data';
import { buildPortfolio } from './build';
import { matchL1, matchL2 } from './capabilities';
import { decodeBytes, detectDelimiter, parseCsv, toCsv } from './csv';
import { readMappingJson, suggestMapping, toMapping } from './mapping';
import {
  detectScale,
  parseAmount,
  parseBool,
  parseHosting,
  parseNumber,
  parseScoreRaw,
  parseSensitivity,
  parseType,
  parseYear,
  rescale,
  splitList,
} from './normalize';
import { TARGET_FIELDS, templateRows, validateMapping } from './schema';

const opts = { fileName: 't.csv', catalog: demo.capabilities, assumptions, baseMeta: demo.meta };

describe('CSV parser', () => {
  it('detects ; , tab and | delimiters, ignoring delimiters inside quotes', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('"x,y,z";b\n1;2')).toBe(';');
  });

  it('handles BOM, quotes, escaped quotes, embedded delimiters and newlines, CRLF and ragged rows', () => {
    const t = parseCsv('﻿Name;Note;Cost\r\n"A; B";"He said ""hi""";1\r\n"Multi\r\nline";x\r\n\r\nC;y;3;extra\r\n');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['Name', 'Note', 'Cost']);
    expect(t.rows).toEqual([
      ['A; B', 'He said "hi"', '1'],
      ['Multi\r\nline', 'x', ''],
      ['C', 'y', '3'],
    ]);
  });

  it('parses a file without trailing newline, blank headers and literal quotes mid-field', () => {
    const t = parseCsv('a,,c\n1,12" screen,3');
    expect(t.headers).toEqual(['a', 'Column 2', 'c']);
    expect(t.rows).toEqual([['1', '12" screen', '3']]);
  });

  it('decodes UTF-8 and falls back to Windows-1252 for Excel exports', () => {
    expect(decodeBytes(new TextEncoder().encode('Lønn;Gjøvik'))).toEqual({ text: 'Lønn;Gjøvik', encoding: 'utf-8' });
    expect(decodeBytes(new Uint8Array([0x4c, 0xf8, 0x6e, 0x6e, 0x3b, 0xc5]))).toEqual({ text: 'Lønn;Å', encoding: 'windows-1252' });
  });

  it('round-trips through toCsv', () => {
    const rows = [['name', 'desc'], ['Lønn; Visma', 'says "hi"\nnext']];
    const t = parseCsv(toCsv(rows));
    expect([t.headers, ...t.rows]).toEqual(rows);
  });
});

describe('value normalisation', () => {
  it('reads NOK amounts in Norwegian and English notation', () => {
    const cases: [string, number | null][] = [
      ['1 250 000', 1_250_000], ['1.250.000', 1_250_000], ['1,250,000', 1_250_000], ['kr 95 000,-', 95_000],
      ['NOK 1 234,50', 1234.5], ['2,1 mill', 2_100_000], ['1.2 MNOK', 1_200_000], ['380k', 380_000],
      ['450.000', 450_000], ['12.5', 12.5], ['95 000 NOK', 95_000], ['1 200 000', 1_200_000], ['n/a', null], ['', null],
    ];
    for (const [input, expected] of cases) expect(parseAmount(input), input).toBe(expected);
  });

  it('reads numbers and years from messy cells', () => {
    expect(parseNumber('ca. 900')).toBe(900);
    expect(parseNumber('0,5')).toBe(0.5);
    expect(parseNumber('1 200')).toBe(1200);
    expect(parseYear('31.12.2023')).toBe(2023);
    expect(parseYear('Q4 2020')).toBe(2020);
    expect(parseYear('des. 2024')).toBe(2024);
    expect(parseYear('Vendor managed')).toBeNull();
  });

  it('maps hosting, type, sensitivity and booleans', () => {
    expect(parseHosting('SaaS')?.hosting).toBe('saas');
    expect(parseHosting('Cloud (SaaS)')?.hosting).toBe('saas');
    expect(parseHosting('On-prem')?.hosting).toBe('on_prem_dc');
    expect(parseHosting('Eget datasenter')?.hosting).toBe('on_prem_dc');
    expect(parseHosting('Azure (Norway East)')?.hosting).toBe('public_cloud');
    expect(parseHosting('Hosted (Evry)')?.hosting).toBe('private_cloud');
    expect(parseHosting('Privat sky')?.hosting).toBe('private_cloud');
    expect(parseHosting('Fabrikk (Ålesund)')).toEqual({ hosting: 'on_prem_dc', siteBound: true });
    expect(parseHosting('Filserver')).toBeNull();
    expect(parseType('SaaS')).toBe('saas');
    expect(parseType('Egenutviklet')).toBe('custom');
    expect(parseType('In-house')).toBe('custom');
    expect(parseType('Standard')).toBe('cots');
    expect(parseType('COTS')).toBe('cots');
    expect(parseSensitivity('Sensitiv (helse)')).toBe('special_category');
    expect(parseSensitivity('Ja')).toBe('personal');
    expect(parseSensitivity('Personopplysninger')).toBe('personal');
    expect(parseSensitivity('Ingen persondata')).toBe('internal');
    expect(parseSensitivity('Nei')).toBe('internal');
    expect(parseBool('Ja')).toBe(true);
    expect(parseBool('nei')).toBe(false);
    expect(parseBool('kanskje')).toBeNull();
  });

  it('rescales 1–10 and percentage scores onto 1–5 and reads score words', () => {
    expect(detectScale([1, 4, 5])).toBe(5);
    expect(detectScale([3, 7, 10])).toBe(10);
    expect(detectScale([40, 85])).toBe(100);
    expect([1, 3, 5, 6, 8, 10].map((v) => rescale(v, 10))).toEqual([1, 2, 3, 3, 4, 5]);
    expect(rescale(85, 100)).toBe(4);
    expect(parseScoreRaw('Høy')).toEqual({ value: 4, numeric: false });
    expect(parseScoreRaw('Middels')).toEqual({ value: 3, numeric: false });
    expect(parseScoreRaw('mission critical')).toEqual({ value: 5, numeric: false });
  });

  it('splits lists on ; , | and newlines but not decimal commas', () => {
    expect(splitList('A-001, A-009; SAP ECC | Visma')).toEqual(['A-001', 'A-009', 'SAP ECC', 'Visma']);
    expect(splitList('.NET 4,5')).toEqual(['.NET 4,5']);
  });
});

describe('header heuristics', () => {
  it('maps common English and Norwegian headers', () => {
    const m = toMapping(
      suggestMapping(['App Name', 'Annual cost', 'Owner dept', 'Deployment', 'Vendor', 'TCO NOK', 'Kritikalitet', 'Cost centre', 'Lisenskost/år']),
    );
    expect(m['App Name']).toBe('name');
    expect(m['Owner dept']).toBe('capabilityL1');
    expect(m['Deployment']).toBe('hosting');
    expect(m['Vendor']).toBe('vendor');
    expect(m['Kritikalitet']).toBe('businessCriticality');
    expect(m['Lisenskost/år']).toBe('license');
    expect(['Annual cost', 'TCO NOK'].map((h) => m[h]).sort()).toEqual([null, 'totalCost']);
    expect(m['Cost centre']).toBeNull();
  });

  it('maps template headers (field keys) back exactly', () => {
    const keys = TARGET_FIELDS.map((f) => f.key);
    const m = toMapping(suggestMapping(keys));
    for (const k of keys) expect(m[k], k).toBe(k);
  });

  it('never maps two columns to one field', () => {
    const m = toMapping(suggestMapping(['Name', 'System name', 'Application']));
    expect(Object.values(m).filter((v) => v === 'name')).toHaveLength(1);
  });

  it('validates required fields and duplicates', () => {
    expect(validateMapping({ a: 'name' }).map((i) => i.level)).toContain('error');
    expect(validateMapping({ a: 'name', b: 'totalCost', c: 'capabilityL2' })).toEqual([]);
    expect(validateMapping({ a: 'name', b: 'totalCost', c: 'totalCost' }).some((i) => i.level === 'error')).toBe(true);
  });

  it('loads a mapping JSON and drops unknown fields and columns', () => {
    const { matches, dropped } = readMappingJson(
      { mapping: { Navn: { field: 'name', confidence: 0.9 }, Kost: 'totalCost', X: 'bogus', Missing: 'vendor', Eier: null } },
      ['Navn', 'Kost', 'X', 'Eier'],
    );
    expect(toMapping(matches)).toEqual({ Navn: 'name', Kost: 'totalCost', X: null, Eier: null });
    expect(dropped).toHaveLength(2);
  });
});

describe('capability matching', () => {
  it('matches L1 synonyms and places L2 text on the reference map', () => {
    expect(matchL1('Økonomi')).toBe('Finance');
    expect(matchL1('Salg')).toBe('Sales & CRM');
    expect(matchL2('Lønn', 'HR', demo.capabilities)?.def.id).toBe('HR-CORE');
    expect(matchL2('Fakturabehandling', null, demo.capabilities)?.def.id).toBe('FIN-AP');
    expect(matchL2('Customer Relationship Management', null, demo.capabilities)?.how).toBe('exact');
    expect(matchL2('Flåtestyring', 'Supply Chain', demo.capabilities)).toBeNull();
  });
});

describe('buildPortfolio', () => {
  const csv = [
    'System;Årlig kostnad;Hosting;Kapabilitet;Kritikalitet;Overlapp;Avhenger av',
    'Alpha CRM;1 000 000;SaaS;CRM;5;crm;',
    'Beta CRM;400 000;On-prem;CRM;2;crm;Alpha CRM',
    ';5;;;;;',
    'Gamma;2,5 mill;Kontoret;Kantine;;;Ukjent system',
  ].join('\n');
  const t = parseCsv(csv);
  const mapping = toMapping(suggestMapping(t.headers));
  const { portfolio, report } = buildPortfolio(t, mapping, opts);

  it('skips rows without a name and records defaults and unreadable cells', () => {
    expect(report.skipped).toEqual([{ row: 4, reason: 'no system name' }]);
    expect(portfolio.systems.map((s) => s.id)).toEqual(['IMP-001', 'IMP-002', 'IMP-003']);
    const gamma = portfolio.systems[2]!;
    expect(gamma.hosting).toBe('on_prem_dc');
    expect(gamma.importNotes!.join(' ')).toMatch(/Could not read Hosting "Kontoret"/);
    expect(gamma.importNotes!.join(' ')).toMatch(/Business criticality = 3 \(neutral\)/);
    expect(report.unresolvedIntegrations).toEqual([{ system: 'Gamma', ref: 'Ukjent system' }]);
  });

  it('splits a total cost by type profile and keeps the total', () => {
    for (const s of portfolio.systems) expect(Object.values(s.annualCost).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const alpha = portfolio.systems[0]!;
    expect(alpha.type).toBe('saas');
    expect(alpha.annualCost.infra).toBe(0);
    expect(Object.values(alpha.annualCost).reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });

  it('creates new capabilities with a flagged SaaS-alternative default', () => {
    const gamma = portfolio.systems[2]!;
    expect(gamma.capability).toEqual({ l1: 'Unclassified', l2: 'Kantine' });
    expect(portfolio.capabilities.find((c) => c.l2 === 'Kantine')?.saasAlternative).toBe(true);
    expect(gamma.importNotes!.join(' ')).toMatch(/SaaS alternative assumed/);
  });

  it('assigns a primary per duplicate group and resolves integrations by name', () => {
    const [alpha, beta] = portfolio.systems;
    expect(alpha!.isPrimary).toBe(true);
    expect(beta!.isPrimary).toBe(false);
    expect(beta!.integrations).toEqual(['IMP-001']);
    expect(report.primariesAssumed).toEqual(['dup-crm']);
    const r = assessPortfolio(portfolio, assumptions);
    expect(r.assessments.find((a) => a.system.id === 'IMP-002')?.time.consolidateInto).toBe('IMP-001');
  });

  it('imports its own template', () => {
    const tt = parseCsv(toCsv(templateRows()));
    const m = toMapping(suggestMapping(tt.headers));
    expect(validateMapping(m)).toEqual([]);
    const { portfolio: p } = buildPortfolio(tt, m, opts);
    expect(p.systems).toHaveLength(1);
    expect(p.systems[0]!.capability.l2).toBe('Core HR & Payroll');
    expect(p.systems[0]!.annualCost).toEqual({ license: 400000, infra: 250000, supportFte: 600000, vendorSupport: 150000 });
    expect(() => assessPortfolio(p, assumptions)).not.toThrow();
  });
});
