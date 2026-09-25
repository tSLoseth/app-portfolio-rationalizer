import { describe, expect, it } from 'vitest';
import { assumptions, portfolio } from './data';
import { capabilityKey, type System } from './types';

const { systems, capabilities } = portfolio;
const ids = new Set(systems.map((s) => s.id));
const totalCost = (s: System) =>
  s.annualCost.license + s.annualCost.infra + s.annualCost.supportFte + s.annualCost.vendorSupport;

describe('portfolio.json invariants', () => {
  it('has exactly 150 systems with unique ids', () => {
    expect(systems).toHaveLength(150);
    expect(ids.size).toBe(150);
  });

  it('only integrates with existing systems, never itself, without duplicates', () => {
    for (const s of systems) {
      expect(new Set(s.integrations).size, s.id).toBe(s.integrations.length);
      for (const dep of s.integrations) {
        expect(ids.has(dep), `${s.id} -> ${dep}`).toBe(true);
        expect(dep).not.toBe(s.id);
      }
    }
  });

  it('keeps all scores within 1–5 as integers', () => {
    for (const s of systems) {
      const scores = [s.businessCriticality, ...Object.values(s.businessFit), ...Object.values(s.technicalFit)];
      for (const v of scores) {
        expect(Number.isInteger(v), s.id).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(5);
      }
    }
  });

  it('uses valid enums and consistent type/hosting', () => {
    for (const s of systems) {
      expect(['core', 'acquired_A', 'acquired_B', 'shadow_it']).toContain(s.origin);
      expect(['custom', 'cots', 'saas']).toContain(s.type);
      expect(['on_prem_dc', 'private_cloud', 'saas', 'public_cloud']).toContain(s.hosting);
      expect(['public', 'internal', 'personal', 'special_category']).toContain(s.dataSensitivity);
      expect(['S', 'M', 'L', 'XL']).toContain(s.sizeClass);
      if (s.type === 'saas') expect(s.hosting).toBe('saas');
      if (s.dataSensitivity === 'special_category') expect(s.residencyRequired).toBe(true);
    }
  });

  it('maps every system to a defined capability; ~8 L1 × 3–5 L2', () => {
    const defined = new Set(capabilities.map(capabilityKey));
    for (const s of systems) expect(defined.has(capabilityKey(s.capability)), s.id).toBe(true);
    const l1s = new Set(capabilities.map((c) => c.l1));
    expect(l1s.size).toBe(8);
    for (const l1 of l1s) {
      const n = capabilities.filter((c) => c.l1 === l1).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('has non-negative costs and a plausible total run cost', () => {
    for (const s of systems) for (const v of Object.values(s.annualCost)) expect(v).toBeGreaterThanOrEqual(0);
    const total = systems.reduce((a, s) => a + totalCost(s), 0);
    expect(total).toBeGreaterThan(250e6);
    expect(total).toBeLessThan(400e6);
    const costs = systems.map(totalCost);
    expect(Math.min(...costs)).toBeLessThan(150_000);
    expect(Math.max(...costs)).toBeGreaterThan(12e6);
  });

  it('plants the story patterns: 3 CRMs, 4 BI tools, 2 ERPs, shadow IT, EOL platforms', () => {
    const inGroup = (g: string) => systems.filter((s) => s.duplicateGroup === g).length;
    expect(inGroup('dup-crm')).toBe(3);
    expect(inGroup('dup-bi')).toBe(4);
    expect(inGroup('dup-erp')).toBe(2);
    expect(systems.filter((s) => s.origin === 'shadow_it').length).toBeGreaterThanOrEqual(5);
    expect(systems.filter((s) => s.origin === 'acquired_A').length).toBeGreaterThan(5);
    expect(systems.filter((s) => s.origin === 'acquired_B').length).toBeGreaterThan(5);
    const expired = systems.filter((s) => s.platformEolYear !== null && s.platformEolYear < portfolio.meta.referenceYear);
    expect(expired.length).toBeGreaterThanOrEqual(10);
    const criticalLegacy = systems.filter(
      (s) => s.type === 'custom' && s.businessCriticality >= 4 && s.technicalFit.eolRisk <= 2,
    );
    expect(criticalLegacy.length).toBeGreaterThanOrEqual(3);
  });

  it('has well-formed duplicate groups in at least 4 L2 capabilities', () => {
    const groups = new Map<string, System[]>();
    for (const s of systems) if (s.duplicateGroup) groups.set(s.duplicateGroup, [...(groups.get(s.duplicateGroup) ?? []), s]);
    const l2s = new Set<string>();
    for (const [g, members] of groups) {
      expect(members.length, g).toBeGreaterThanOrEqual(2);
      expect(members.filter((m) => m.isPrimary).length, g).toBe(1);
      expect(new Set(members.map((m) => capabilityKey(m.capability))).size, g).toBe(1);
      l2s.add(capabilityKey(members[0]!.capability));
    }
    expect(l2s.size).toBeGreaterThanOrEqual(4);
  });

  it('has ERP and IAM as integration hubs', () => {
    const inDegree = new Map<string, number>();
    for (const s of systems) for (const d of s.integrations) inDegree.set(d, (inDegree.get(d) ?? 0) + 1);
    const top = [...inDegree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
    const topCaps = top.map((id) => systems.find((s) => s.id === id)!.capability.l2);
    expect(topCaps).toContain('ERP & General Ledger');
    expect(topCaps).toContain('Identity & Access Management');
  });

  it('marks some capabilities without a SaaS alternative', () => {
    expect(capabilities.some((c) => !c.saasAlternative)).toBe(true);
    expect(capabilities.some((c) => c.saasAlternative)).toBe(true);
  });
});

describe('assumptions.json', () => {
  const params: [string, Record<string, unknown>][] = [];
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const obj = node as Record<string, unknown>;
      if ('value' in obj) return void params.push([path, obj]);
      for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    params.push([path, { bare: node }]);
  };
  const { version: _v, currency: _c, ...rest } = assumptions;
  walk(rest, '');

  it('wraps every parameter with value, unit and description', () => {
    expect(params.length).toBeGreaterThan(30);
    for (const [path, p] of params) {
      expect('value' in p, `${path} is a bare value`).toBe(true);
      expect(typeof p.unit, path).toBe('string');
      expect(typeof p.description, path).toBe('string');
    }
  });

  it('labels every parameter with a source or estimate + rationale', () => {
    for (const [path, p] of params) {
      const sourced = typeof p.source === 'string' && p.source.length > 0;
      const estimated = p.estimate === true && typeof p.rationale === 'string' && p.rationale.length > 10;
      expect(sourced || estimated, path).toBe(true);
    }
  });

  it('has weights that sum to 1', () => {
    const sum = (o: Record<string, { value: number }>) => Object.values(o).reduce((a, p) => a + p.value, 0);
    expect(sum(assumptions.time.businessValueWeights)).toBeCloseTo(1);
    expect(sum(assumptions.time.technicalHealthWeights)).toBeCloseTo(1);
  });
});
