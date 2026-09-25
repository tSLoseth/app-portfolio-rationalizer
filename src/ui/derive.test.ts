import { describe, expect, it } from 'vitest';
import csv from '../../public/sample-inventory.csv?raw';
import sample from '../../public/sample-inventory.csv.mapping.json';
import { assessPortfolio } from '../engine/assess';
import { parseCsv } from '../import/csv';
import { readMappingJson, toMapping } from '../import/mapping';
import { assumptions, portfolio as demo } from '../model/data';
import { findings, headline, kpis } from './derive';
import { assumptionsForImport, buildFrom } from './importState';

const table = parseCsv(csv);
const mapping = toMapping(readMappingJson(sample, table.headers).matches);

const text = (p: typeof demo, a: typeof assumptions) => {
  const r = assessPortfolio(p, a);
  return { r, all: [headline(r), ...findings(r, a, p.meta).flatMap((f) => [f.title, f.body]), ...r.cost.waterfall.map((w) => w.label)].join('\n') };
};

describe('overview texts follow the data, not the demo narrative', () => {
  it('uses the post-merger and lease story for the demo', () => {
    const { all } = text(demo, assumptions);
    expect(all).toMatch(/Post-merger/);
    expect(all).toMatch(/lease deadline/);
    expect(all).toMatch(/DC facility/);
    expect(kpis(demo, assessPortfolio(demo, assumptions)).postMerger).toBe(true);
  });

  it('drops acquisitions, lease and facility wording for an imported inventory', () => {
    const { portfolio } = buildFrom(table, 'sample-inventory.csv', mapping);
    expect(portfolio.systems.length).toBeGreaterThan(20);
    const a = assumptionsForImport(assumptions);
    const { r, all } = text(portfolio, a);
    expect(r.cost.dataCenterFacilityAnnual).toBe(0);
    expect(all).not.toMatch(/merger|M&A|acquisition|lease|facility|Nordlys/i);
    expect(kpis(portfolio, r).postMerger).toBe(false);
  });
});
