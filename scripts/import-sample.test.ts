import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assessPortfolio } from '../src/engine/assess';
import { buildPortfolio } from '../src/import/build';
import { parseCsv } from '../src/import/csv';
import { suggestMapping, toMapping } from '../src/import/mapping';
import { validateMapping } from '../src/import/schema';
import { assumptions, portfolio as demo } from '../src/model/data';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const table = parseCsv(readFileSync(resolve(root, 'public/sample-inventory.csv'), 'utf8'));

// Hand-labelled ground truth for the sample's messy headers.
const SAMPLE_TRUTH: Record<string, string | null> = {
  'Sys-ID': 'externalId',
  Applikasjon: 'name',
  Leverandør: 'vendor',
  Beskrivelse: 'description',
  'Owner dept': 'capabilityL1',
  'Business capability': 'capabilityL2',
  'Hosting/Deployment': 'hosting',
  'Type (SaaS/COTS/Custom)': 'type',
  'Platform / OS': 'techStack',
  'End of support': 'platformEolYear',
  'Antall brukere': 'users',
  'Criticality (1-10)': 'businessCriticality',
  'Business fit': 'businessFit',
  'Tech health (1-5)': 'technicalFit',
  'TCO (NOK/år)': 'totalCost',
  'Lisenskost/år': 'license',
  'Support FTE': 'supportFteCount',
  'Persondata?': 'dataSensitivity',
  'Integrerer med': 'integrations',
  'Overlapp-gruppe': 'duplicateGroup',
  'Sist oppgradert': 'lastMajorUpgrade',
  Eier: null,
  Kommentar: null,
};

describe('sample inventory (public/sample-inventory.csv) end to end', () => {
  it('parses 25 systems with a BOM, semicolons and a quoted newline', () => {
    expect(table.delimiter).toBe(';');
    expect(table.headers[0]).toBe('Sys-ID');
    expect(table.rows).toHaveLength(25);
    expect(table.rows.every((r) => r.length === table.headers.length)).toBe(true);
    expect(table.rows.some((r) => r.some((c) => c.includes('\n')))).toBe(true);
  });

  const mapping = toMapping(suggestMapping(table.headers));

  it('maps every header like the hand-labelled truth', () => {
    expect(Object.keys(SAMPLE_TRUTH).sort()).toEqual([...table.headers].sort());
    expect(mapping).toEqual(SAMPLE_TRUTH);
    expect(validateMapping(mapping).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('builds a portfolio the engine assesses for every row', () => {
    const { portfolio, report } = buildPortfolio(table, mapping, {
      fileName: 'sample-inventory.csv',
      catalog: demo.capabilities,
      assumptions,
      baseMeta: demo.meta,
    });
    expect(report.systems).toBe(25);
    expect(report.skipped).toEqual([]);
    expect(report.rescaled).toEqual([{ field: 'businessCriticality', header: 'Criticality (1-10)', scale: 10 }]);
    expect(report.duplicateGroups).toBe(3);
    expect(report.unresolvedIntegrations).toEqual([]);
    expect(report.newCapabilities.map((c) => c.l2)).toEqual(['Flåtestyring']);
    expect(report.unreadable).toEqual([{ row: 16, field: 'hosting', value: 'Filserver' }]);

    const byName = new Map(portfolio.systems.map((s) => [s.name, s]));
    expect(byName.get('Salesforce Sales Cloud')).toMatchObject({ type: 'saas', hosting: 'saas', isPrimary: true, duplicateGroup: 'dup-crm' });
    expect(byName.get('MES Linje 2')).toMatchObject({ siteBound: true, capability: { l1: 'Production/OT', l2: 'Manufacturing Execution' } });
    expect(byName.get('Visma Lønn')).toMatchObject({ dataSensitivity: 'special_category', residencyRequired: true, businessCriticality: 5 });
    expect(byName.get('Kundeportal (egenutviklet)')!.integrations.map((id) => portfolio.systems.find((s) => s.id === id)!.name)).toEqual([
      'SAP ECC 6.0',
      'Salesforce Sales Cloud',
    ]);

    const r = assessPortfolio(portfolio, assumptions);
    expect(r.assessments).toHaveLength(25);
    for (const a of r.assessments) {
      expect(a.time.category, a.system.name).toBeTruthy();
      expect(a.sixR.sixR, a.system.name).toBeTruthy();
      expect(Number.isFinite(a.cost.npv), a.system.name).toBe(true);
    }
    expect(r.assessments.find((a) => a.system.name === 'SuperOffice CRM')?.sixR.sixR).toBe('retire');
    expect(Number.isFinite(r.cost.npv)).toBe(true);
  });
});
