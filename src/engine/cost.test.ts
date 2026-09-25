import { describe, expect, it } from 'vitest';
import { assumptions as base, portfolio } from '../model/data';
import type { Assumptions, SixR, SixRResult } from '../model/types';
import { assessCosts, immediateTiming, npvOf, summarizePortfolioCost, type CostTiming } from './cost';
import { makeSystem } from './fixtures';
import { buildGraph } from './graph';
import { withOverrides } from './overrides';
import { assessSixRAll } from './sixR';
import { assessTimeAll } from './time';

// Short horizon and a small facility so every expected number can be checked by hand.
const a: Assumptions = {
  ...base,
  cost: {
    ...base.cost,
    horizonYears: { ...base.cost.horizonYears, value: 1 },
    dataCenterAnnualFixedCostNok: { ...base.cost.dataCenterAnnualFixedCostNok, value: 400_000 },
  },
};
const d = (k: number) => Math.pow(1.08, -(k + 1) / 4);

const systems = [
  makeSystem({ id: 'A', sizeClass: 'S', annualCost: { license: 100_000, infra: 50_000, supportFte: 200_000, vendorSupport: 50_000 } }),
  makeSystem({ id: 'B', sizeClass: 'M', integrations: ['A'], annualCost: { license: 200_000, infra: 400_000, supportFte: 300_000, vendorSupport: 100_000 } }),
  makeSystem({ id: 'C', sizeClass: 'S', type: 'custom', annualCost: { license: 40_000, infra: 20_000, supportFte: 100_000, vendorSupport: 0 } }),
  makeSystem({ id: 'D', sizeClass: 'S', annualCost: { license: 100_000, vendorSupport: 20_000 } }),
  makeSystem({ id: 'E', hosting: 'saas', type: 'saas', annualCost: { license: 10_000 } }),
];
const r = (systemId: string, sixR: SixR, consolidateInto?: string): SixRResult => ({
  systemId,
  sixR,
  flags: [],
  ...(consolidateInto ? { consolidateInto } : {}),
  rationale: [],
});
const sixRs = [r('A', 'retire'), r('B', 'rehost'), r('C', 'repurchase'), r('D', 'retire', 'B'), r('E', 'retain')];
const costs = assessCosts(systems, sixRs, a);
const cost = (id: string) => costs.find((c) => c.systemId === id)!;

describe('per-system cost (hand-computed)', () => {
  it('retire: saves the full baseline; one-off = retire rate × integration multiplier', () => {
    const c = cost('A');
    expect(c.baselineAnnual).toBe(400_000);
    expect(c.targetAnnual).toBe(0);
    expect(c.annualSaving).toBe(400_000);
    expect(c.integrationMultiplier).toBeCloseTo(1.08); // B depends on A → 1 inbound
    expect(c.oneOffMigration).toBeCloseTo(54_000);
    expect(c.paybackYears).toBeCloseTo(0.135);
    expect(c.npv).toBeCloseTo(-54_000 * d(0) + 100_000 * (d(1) + d(2) + d(3)), 6);
    expect(c.npv).toBeCloseTo(230_238.03, 1);
  });

  it('rehost: licences ×1, support ×0.9, infra ×0.9 as cloud run cost', () => {
    const c = cost('B');
    expect(c.target).toEqual({ licenseAndVendor: 300_000, internalSupport: 270_000, keptInfra: 0, cloudRun: 360_000, consolidationUplift: 0 });
    expect(c.targetAnnual).toBe(930_000);
    expect(c.annualSaving).toBe(70_000);
    expect(c.oneOffMigration).toBeCloseTo(432_000);
    expect(c.migrationPersonDays).toBeCloseTo(432_000 / 11_000);
    expect(c.paybackYears).toBeCloseTo(432 / 70);
  });

  it('repurchase: subscription floor applies and it never pays back', () => {
    const c = cost('C');
    expect(c.target.cloudRun).toBe(150_000); // max(150k, 1.25 × 60k)
    expect(c.target.internalSupport).toBe(50_000);
    expect(c.annualSaving).toBe(-40_000);
    expect(c.oneOffMigration).toBe(250_000);
    expect(c.paybackYears).toBeNull();
  });

  it('consolidation retire: pays consolidation cost and a run-cost uplift on the primary', () => {
    const c = cost('D');
    expect(c.consolidationCost).toBe(150_000);
    expect(c.migrationCost).toBe(50_000);
    expect(c.oneOffMigration).toBe(200_000);
    expect(c.target.consolidationUplift).toBeCloseTo(36_000);
    expect(c.annualSaving).toBeCloseTo(84_000);
  });

  it('retain: unchanged cost, nothing to pay back', () => {
    const c = cost('E');
    expect(c.annualSaving).toBe(0);
    expect(c.oneOffMigration).toBe(0);
    expect(c.paybackYears).toBeNull();
  });

  it('scales price, not effort, with the migration-cost multiplier', () => {
    const dear = assessCosts(systems, sixRs, withOverrides(a, { migrationCostMultiplier: 1.5 }));
    const b = dear.find((c) => c.systemId === 'B')!;
    expect(b.oneOffMigration).toBeCloseTo(648_000);
    expect(b.migrationPersonDays).toBeCloseTo(cost('B').migrationPersonDays);
  });

  it('caps the integration multiplier', () => {
    const hub = makeSystem({ id: 'H', integrations: Array.from({ length: 30 }, (_, i) => `S${i}`) });
    const [c] = assessCosts([hub], [r('H', 'rehost')], a, buildGraph([hub]));
    expect(c!.integrationMultiplier).toBe(2);
  });

  it('costs the XL core ERP as a programme estimate instead of the rate card', () => {
    const erp = (id: string, sizeClass: 'L' | 'XL') =>
      makeSystem({ id, sizeClass, capability: { l1: 'Finance', l2: 'ERP & General Ledger' }, integrations: Array.from({ length: 30 }, (_, i) => `S${i}`) });
    const sys = [erp('ERP', 'XL'), erp('SAT', 'L'), erp('OLD', 'XL')];
    const six = [r('ERP', 'repurchase'), r('SAT', 'repurchase'), r('OLD', 'retire')];
    const [big, small, old] = assessCosts(sys, six, a, buildGraph(sys));
    expect(big!.erpProgramme).toBe(true);
    expect(big!.oneOffMigration).toBe(80_000_000); // replaces 6M × 2.0 = 12M
    expect(big!.migrationPersonDays).toBeCloseTo(80_000_000 / 11_000);
    expect(big!.rationale.join(' ')).toContain('ERP programme estimate');
    expect(small!.erpProgramme).toBeUndefined();
    expect(small!.oneOffMigration).toBe(4_000_000); // L repurchase 2M × capped 2.0
    expect(old!.oneOffMigration).toBe(2_000_000); // retirements keep the rate card
    const dear = assessCosts(sys, six, withOverrides(a, { migrationCostMultiplier: 1.3 }), buildGraph(sys));
    expect(dear[0]!.oneOffMigration).toBeCloseTo(104_000_000);
    expect(dear[0]!.migrationPersonDays).toBeCloseTo(big!.migrationPersonDays);
  });
});

describe('portfolio summary (hand-computed)', () => {
  const summary = summarizePortfolioCost(systems, sixRs, a);

  it('steady-state baseline, target, saving and payback', () => {
    expect(summary.baselineAnnual).toBe(2_090_000);
    expect(summary.targetAnnual).toBeCloseTo(1_176_000);
    expect(summary.annualSaving).toBeCloseTo(914_000);
    expect(summary.oneOffMigration).toBeCloseTo(936_000);
    expect(summary.paybackYears).toBeCloseTo(936 / 914);
  });

  it('builds a waterfall that sums from baseline to target', () => {
    const w = Object.fromEntries(summary.waterfall.map((s) => [s.key, s.value]));
    expect(w.baseline).toBe(2_090_000);
    expect(w.retire).toBeCloseTo(-484_000);
    expect(w.rightsizing).toBeCloseTo(-120_000);
    expect(w.infraExit).toBeCloseTo(-820_000);
    expect(w.cloudRun).toBeCloseTo(510_000);
    expect(w.target).toBeCloseTo(summary.targetAnnual);
  });

  it('computes NPV from quarterly flows (immediate timing)', () => {
    expect(summary.npv).toBeCloseTo(-936_000 * d(0) + 228_500 * (d(1) + d(2) + d(3)), 4);
    expect(summary.npv).toBeCloseTo(-271_030.73, 1);
    expect(summary.cashFlows).toHaveLength(1);
    expect(summary.cashFlows[0]!.investment).toBeCloseTo(936_000);
    expect(summary.cashFlows[0]!.saving).toBeCloseTo(3 * 228_500);
  });

  it('respects roadmap timing: spread investment, bridges, savings after cutover, no facility if DC stays', () => {
    const timing: CostTiming = { systems: new Map([['B', { start: 0, cutover: 1, bridgePersonDays: 10 }]]), dcExit: null };
    const npv = npvOf([cost('B')], timing, a);
    expect(npv).toBeCloseTo(-216_000 * d(0) - (216_000 + 110_000) * d(1) + 17_500 * (d(2) + d(3)), 4);
    expect(npv).toBeCloseTo(-492_855.29, 1);
  });

  it('keeps the DC facility in the target when the DC is never vacated', () => {
    const s = summarizePortfolioCost(systems, sixRs, a, { systems: new Map(), dcExit: null });
    expect(s.targetAnnual).toBeCloseTo(1_176_000 + 400_000);
  });

  it('runs a ±30 % sensitivity grid on cloud factor and migration cost', () => {
    const { grid, tornado, npvMin, npvMax } = summary.sensitivity;
    expect(grid).toHaveLength(9);
    const mig = tornado.find((t) => t.parameter === 'Migration cost')!;
    expect(mig.npvAtHigh - summary.npv).toBeCloseTo(-0.3 * 936_000 * d(0), 4);
    const cloud = tornado.find((t) => t.parameter === 'Cloud run cost')!;
    expect(cloud.npvAtLow).toBeGreaterThan(summary.npv);
    expect(cloud.npvAtHigh).toBeLessThan(summary.npv);
    expect(npvMin).toBeLessThanOrEqual(summary.npv);
    expect(npvMax).toBeGreaterThanOrEqual(summary.npv);
    expect(npvMin).toBe(grid.find((g) => g.cloudRunCostFactor === 1.3 && g.migrationCostMultiplier === 1.3)!.npv);
  });

  it('withOverrides changes the discount rate without mutating the input', () => {
    const higher = withOverrides(a, { discountRate: 0.12 });
    expect(a.cost.discountRate.value).toBe(0.08);
    expect(summarizePortfolioCost(systems, sixRs, higher).npv).toBeLessThan(summary.npv);
  });
});

describe('cost on the real portfolio (sanity)', () => {
  const times = assessTimeAll(portfolio.systems, base);
  const real6R = assessSixRAll(portfolio.systems, portfolio.capabilities, times, base);
  const s = summarizePortfolioCost(portfolio.systems, real6R, base, immediateTiming(portfolio.systems, real6R));

  it('produces finite, plausible headline numbers', () => {
    expect(Number.isFinite(s.npv)).toBe(true);
    expect(s.baselineAnnual).toBeGreaterThan(250e6);
    expect(s.targetAnnual).toBeLessThan(s.baselineAnnual);
    expect(s.paybackYears).not.toBeNull();
    expect(s.paybackYears!).toBeGreaterThan(0.5);
    expect(s.paybackYears!).toBeLessThan(6);
    expect(s.sensitivity.npvMin).toBeLessThan(s.sensitivity.npvMax);
  });

  it('matches the sum of standalone system NPVs plus the facility under immediate timing', () => {
    const costs = assessCosts(portfolio.systems, real6R, base);
    const facilityNpv = Array.from({ length: 19 }, (_, i) => (18e6 / 4) * Math.pow(1.08, -(i + 2) / 4)).reduce((x, y) => x + y, 0);
    expect(s.npv).toBeCloseTo(costs.reduce((x, c) => x + c.npv, 0) + facilityNpv, 0);
  });
});
