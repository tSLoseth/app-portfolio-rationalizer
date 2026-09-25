import { describe, expect, it } from 'vitest';
import { assumptions as a, portfolio } from '../model/data';
import type { System, TimeCategory, TimeResult } from '../model/types';
import { makeCapability, makeSystem } from './fixtures';
import { buildGraph } from './graph';
import { assessSixR, assessSixRAll } from './sixR';
import { assessTimeAll } from './time';

const time = (category: TimeCategory, businessValue = 3, consolidateInto?: string): TimeResult => ({
  systemId: 'X',
  businessValue,
  technicalHealth: 3,
  eolPenalty: 0,
  yearsToEol: null,
  quadrant: category,
  category,
  overridesApplied: [],
  flags: [],
  ...(consolidateInto ? { consolidateInto } : {}),
  rationale: [],
});

const noAlt = makeCapability('No alternative', false);
const withAlt = { ...makeCapability('Has alternative', true), saasAlternativeExample: 'SaaSCo' };

function run(s: System, t: TimeResult, cap = noAlt, others: System[] = []) {
  return assessSixR(s, t, cap, buildGraph([s, ...others]), a);
}

describe('6R decision tree', () => {
  it('Eliminate → retire', () => {
    const r = run(makeSystem(), time('eliminate'));
    expect(r.sixR).toBe('retire');
    expect(r.flags).toEqual([]);
  });

  it('Eliminate with consolidation target → retire flagged as consolidation', () => {
    const r = assessSixR(makeSystem(), time('eliminate', 3, 'P'), noAlt, buildGraph([makeSystem()]), a, () => 'Primary ERP');
    expect(r.sixR).toBe('retire');
    expect(r.flags).toContain('consolidation');
    expect(r.consolidateInto).toBe('P');
    expect(r.rationale.join(' ')).toContain('into Primary ERP');
  });

  it('Tolerate + on-prem + low complexity → rehost', () => {
    const r = run(makeSystem({ sizeClass: 'S', integrations: ['A', 'B'] }), time('tolerate'));
    expect(r.sixR).toBe('rehost');
    expect(r.flags).toEqual([]);
  });

  it('counts inbound integrations too: 4 total exceeds the low-complexity limit of 3', () => {
    const s = makeSystem({ sizeClass: 'S', integrations: ['A', 'B'] });
    const users = ['U1', 'U2'].map((id) => makeSystem({ id, integrations: ['X'] }));
    const r = run(s, time('tolerate'), noAlt, users);
    expect(r.sixR).toBe('rehost');
    expect(r.flags).toContain('dc_exit_forced');
  });

  it('Tolerate + on-prem + large → forced rehost because the data center closes', () => {
    const r = run(makeSystem({ sizeClass: 'L' }), time('tolerate'));
    expect(r.sixR).toBe('rehost');
    expect(r.flags).toEqual(['dc_exit_forced']);
  });

  it('Tolerate off the data center → retain', () => {
    expect(run(makeSystem({ hosting: 'saas', type: 'saas' }), time('tolerate')).sixR).toBe('retain');
    expect(run(makeSystem({ hosting: 'private_cloud' }), time('tolerate')).sixR).toBe('retain');
  });

  it('Migrate + SaaS alternative in the capability → repurchase (even for custom)', () => {
    const r = run(makeSystem({ type: 'custom' }), time('migrate', 4.5), withAlt);
    expect(r.sixR).toBe('repurchase');
    expect(r.rationale.join(' ')).toContain('SaaSCo');
  });

  it('Migrate + custom + high value → refactor (boundary: exactly 3.5)', () => {
    expect(run(makeSystem({ type: 'custom' }), time('migrate', 3.5)).sixR).toBe('refactor');
  });

  it('Migrate + custom below refactor threshold → replatform', () => {
    expect(run(makeSystem({ type: 'custom' }), time('migrate', 3.45)).sixR).toBe('replatform');
  });

  it('Migrate + COTS without alternative → replatform', () => {
    expect(run(makeSystem({ type: 'cots' }), time('migrate', 4.8)).sixR).toBe('replatform');
  });

  it('Migrate + already SaaS without alternative → retain', () => {
    expect(run(makeSystem({ type: 'saas', hosting: 'saas' }), time('migrate')).sixR).toBe('retain');
  });

  it('Invest + on-prem: large custom → refactor, large COTS → replatform, small → replatform', () => {
    expect(run(makeSystem({ type: 'custom', sizeClass: 'XL' }), time('invest')).sixR).toBe('refactor');
    expect(run(makeSystem({ type: 'cots', sizeClass: 'L' }), time('invest')).sixR).toBe('replatform');
    expect(run(makeSystem({ type: 'custom', sizeClass: 'M' }), time('invest')).sixR).toBe('replatform');
  });

  it('Invest already in cloud/SaaS → retain', () => {
    expect(run(makeSystem({ hosting: 'saas', type: 'saas' }), time('invest')).sixR).toBe('retain');
    expect(run(makeSystem({ hosting: 'public_cloud' }), time('invest')).sixR).toBe('retain');
  });

  it('site-bound plant systems are retained regardless of TIME, outside DC exit', () => {
    for (const c of ['eliminate', 'migrate', 'tolerate', 'invest'] as const) {
      const r = run(makeSystem({ siteBound: true }), time(c));
      expect(r.sixR).toBe('retain');
      expect(r.flags).toContain('site_bound');
      expect(r.rationale.join(' ')).toContain('not part of the data-center exit');
    }
  });
});

describe('data residency rule', () => {
  it('flags special-category data moving to the cloud', () => {
    const s = makeSystem({ dataSensitivity: 'special_category', residencyRequired: true });
    const r = run(s, time('migrate'), withAlt);
    expect(r.sixR).toBe('repurchase');
    expect(r.flags).toContain('requires_eu_no_region');
  });

  it('flags residency-required personal data too', () => {
    const s = makeSystem({ dataSensitivity: 'personal', residencyRequired: true, sizeClass: 'S' });
    expect(run(s, time('tolerate')).flags).toContain('requires_eu_no_region');
  });

  it('does not flag when the system is not moving', () => {
    const s = makeSystem({ dataSensitivity: 'special_category', residencyRequired: true });
    expect(run(s, time('eliminate')).flags).not.toContain('requires_eu_no_region');
    expect(run({ ...s, hosting: 'saas', type: 'saas' }, time('invest')).flags).not.toContain('requires_eu_no_region');
  });
});

describe('6R on the real portfolio', () => {
  const times = assessTimeAll(portfolio.systems, a);
  const results = assessSixRAll(portfolio.systems, portfolio.capabilities, times, a);

  it('uses every one of the six Rs', () => {
    const used = new Set(results.map((r) => r.sixR));
    expect([...used].sort()).toEqual(['refactor', 'rehost', 'replatform', 'repurchase', 'retain', 'retire']);
  });

  it('retains no data-center system unless it is site-bound', () => {
    for (const s of portfolio.systems) {
      const r = results.find((x) => x.systemId === s.id)!;
      if (s.hosting === 'on_prem_dc' && r.sixR === 'retain') expect(s.siteBound, s.name).toBe(true);
    }
  });

  it('carries every TIME consolidation into a retire', () => {
    for (const t of times.filter((t) => t.consolidateInto)) {
      const s = portfolio.systems.find((x) => x.id === t.systemId)!;
      const r = results.find((x) => x.systemId === t.systemId)!;
      if (!s.siteBound) expect(r.consolidateInto).toBe(t.consolidateInto);
    }
  });

  it('points a consolidation at the future state when the group standard is itself transformed', () => {
    const nav = results.find((r) => r.systemId === 'SYS-012')!;
    expect(nav.consolidateInto).toBe('SYS-011');
    expect(results.find((r) => r.systemId === 'SYS-011')!.sixR).toBe('repurchase');
    expect(nav.consolidationTargetFuture).toEqual({ sixR: 'repurchase', futureState: 'SAP S/4HANA Cloud-class SaaS replacement' });
    expect(nav.rationale.at(-1)).toMatch(/itself being repurchased, so the consolidation lands on its future state/);
    expect(nav.rationale[0]).toContain('into the future state of SAP ECC 6.0 (Nordlys core) (SAP S/4HANA Cloud-class SaaS replacement)');
    for (const r of results.filter((x) => x.consolidateInto && !x.consolidationTargetFuture)) {
      expect(['retire', 'retain', 'rehost']).toContain(results.find((x) => x.systemId === r.consolidateInto)!.sixR);
    }
  });
});
