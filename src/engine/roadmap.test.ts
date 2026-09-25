import { describe, expect, it } from 'vitest';
import { assumptions as base, portfolio } from '../model/data';
import type { Assumptions, CostResult, RoadmapResult, SixR, SixRResult, System } from '../model/types';
import { assessPortfolio, withOverrides } from './assess';
import { makeSystem } from './fixtures';
import { buildGraph, topologicalOrder } from './graph';
import { quarterIndex } from './quarters';
import { planRoadmap, roadmapTiming } from './roadmap';

function withRoadmap(patch: Partial<Record<keyof Assumptions['roadmap'], unknown>>): Assumptions {
  const roadmap = { ...base.roadmap } as Record<string, { value: unknown }>;
  for (const [k, v] of Object.entries(patch)) roadmap[k] = { ...roadmap[k]!, value: v };
  return { ...base, roadmap: roadmap as unknown as Assumptions['roadmap'] };
}

interface Spec {
  id: string;
  sixR: SixR;
  pd?: number;
  deps?: string[];
  crit?: number;
  into?: string;
  hosting?: System['hosting'];
  siteBound?: boolean;
}

function plan(specs: Spec[], a: Assumptions = base): RoadmapResult {
  const systems = specs.map((s) =>
    makeSystem({ id: s.id, name: `Sys ${s.id}`, integrations: s.deps ?? [], businessCriticality: s.crit ?? 3, hosting: s.hosting ?? 'on_prem_dc', siteBound: s.siteBound ?? false }),
  );
  const sixRs: SixRResult[] = specs.map((s) => ({ systemId: s.id, sixR: s.sixR, flags: [], ...(s.into ? { consolidateInto: s.into } : {}), rationale: [] }));
  const costs = specs.map((s) => ({ systemId: s.id, sixR: s.sixR, migrationPersonDays: s.pd ?? 20 }) as CostResult);
  return planRoadmap(systems, sixRs, costs, a, buildGraph(systems));
}

const item = (r: RoadmapResult, id: string) => r.items.find((i) => i.systemId === id)!;
const qi = (r: RoadmapResult, id: string) => quarterIndex(item(r, id).quarter);

describe('roadmap waves and dependencies', () => {
  it('assigns waves by 6R: quick-win retire 0, rehost 1, replatform 2, refactor/repurchase 3', () => {
    const r = plan([
      { id: 'R', sixR: 'retire' },
      { id: 'H', sixR: 'rehost' },
      { id: 'P', sixR: 'replatform' },
      { id: 'F', sixR: 'refactor' },
      { id: 'U', sixR: 'repurchase' },
      { id: 'K', sixR: 'retain' },
    ]);
    expect(Object.fromEntries(r.items.map((i) => [i.systemId, i.wave]))).toEqual({ R: 0, H: 1, P: 2, F: 3, U: 3 });
    expect(r.retained).toEqual(['K']);
  });

  it('moves retirements with many dependants and complex rehosts to later waves', () => {
    const r = plan([
      { id: 'R', sixR: 'retire' },
      { id: 'A', sixR: 'retain', deps: ['R'] },
      { id: 'B', sixR: 'retain', deps: ['R'] },
      { id: 'C', sixR: 'retain', deps: ['R', 'H'] },
      { id: 'H', sixR: 'rehost', deps: ['A', 'B', 'X'] },
      { id: 'X', sixR: 'retain' },
    ]);
    expect(item(r, 'R').wave).toBe(1);
    expect(item(r, 'H').wave).toBe(2);
  });

  it('moves a dependency no later than its dependant within a wave (topological order)', () => {
    const r = plan([
      { id: 'A', sixR: 'replatform', deps: ['B'] },
      { id: 'B', sixR: 'replatform', deps: ['C'], pd: 900 },
      { id: 'C', sixR: 'replatform' },
    ]);
    expect(qi(r, 'C')).toBeLessThanOrEqual(qi(r, 'B'));
    expect(qi(r, 'B')).toBeLessThanOrEqual(qi(r, 'A'));
    expect(item(r, 'A').temporaryIntegrations).toEqual([]);
    expect(item(r, 'A').rationale.join(' ')).toContain('Waits for dependency Sys B');
  });

  it('bridges a dependency that moves in a later wave with a temporary integration', () => {
    const r = plan([
      { id: 'A', sixR: 'rehost', deps: ['B'] },
      { id: 'B', sixR: 'refactor' },
    ]);
    expect(item(r, 'A').temporaryIntegrations).toEqual(['B']);
    expect(item(r, 'A').bridgePersonDays).toBe(10);
    expect(item(r, 'A').personDays).toBe(30);
  });

  it('spreads large migrations over several quarters', () => {
    const r = plan([{ id: 'A', sixR: 'refactor', pd: 1000 }]);
    expect(item(r, 'A').durationQuarters).toBe(3);
    expect(item(r, 'A').startQuarter).toBe('2027Q1');
    expect(item(r, 'A').quarter).toBe('2027Q3');
    expect(r.quarters[0]!.personDays).toBeCloseTo(1000 / 3);
  });
});

describe('cycle breaking', () => {
  it('cuts the edge to the lowest-criticality dependency and bridges it', () => {
    const r = plan([
      { id: 'A', sixR: 'replatform', deps: ['B'], crit: 5 },
      { id: 'B', sixR: 'replatform', deps: ['A'], crit: 2 },
    ]);
    expect(r.cyclesBroken).toHaveLength(1);
    const c = r.cyclesBroken[0]!;
    expect(c.cutEdge).toEqual({ from: 'A', to: 'B' });
    expect(c.cycle).toEqual(['A', 'B', 'A']);
    expect(c.temporaryIntegration).toBe(true);
    expect(c.personDays).toBe(10);
    expect(qi(r, 'A')).toBeLessThanOrEqual(qi(r, 'B'));
  });

  it('prefers cutting an edge that touches a retained system (no bridge needed)', () => {
    const r = plan([
      { id: 'A', sixR: 'replatform', deps: ['B'], crit: 5 },
      { id: 'B', sixR: 'replatform', deps: ['C'], crit: 1 },
      { id: 'C', sixR: 'retain', deps: ['A'], crit: 5 },
    ]);
    const c = r.cyclesBroken[0]!;
    expect([c.cutEdge.from, c.cutEdge.to]).toContain('C');
    expect(c.temporaryIntegration).toBe(false);
  });

  it('is deterministic for equal criticality (latest-wave dependency, then id)', () => {
    const specs: Spec[] = [
      { id: 'A', sixR: 'replatform', deps: ['B'] },
      { id: 'B', sixR: 'repurchase', deps: ['A'] },
    ];
    const first = plan(specs).cyclesBroken;
    expect(first[0]!.cutEdge).toEqual({ from: 'A', to: 'B' });
    expect(plan([...specs].reverse()).cyclesBroken).toEqual(first);
  });
});

describe('capacity', () => {
  it('spills cutovers to the next quarter when the system limit is reached', () => {
    const r = plan(
      ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, sixR: 'retire' as const })),
      withRoadmap({ maxSystemsPerQuarter: 2 }),
    );
    expect(r.quarters.slice(0, 3).map((q) => q.cutovers)).toEqual([2, 2, 1]);
    expect(item(r, 'E').rationale.join(' ')).toContain('Capacity limits pushed cutover');
  });

  it('spills when person-days run out', () => {
    const r = plan(
      [
        { id: 'A', sixR: 'replatform', pd: 300 },
        { id: 'B', sixR: 'replatform', pd: 300 },
      ],
      withRoadmap({ maxPersonDaysPerQuarter: 500 }),
    );
    expect(r.quarters.slice(0, 2).map((q) => q.cutovers)).toEqual([1, 1]);
    for (const q of r.quarters) expect(q.personDays).toBeLessThanOrEqual(500);
  });

  it('reports systems that do not fit before the end quarter as unscheduled', () => {
    const r = plan(
      ['A', 'B', 'C'].map((id) => ({ id, sixR: 'retire' as const })),
      withRoadmap({ maxSystemsPerQuarter: 1, endQuarter: '2027Q2' }),
    );
    expect(r.unscheduled).toEqual(['C']);
    expect(r.dcExit.violations).toContainEqual({ systemId: 'C', reason: 'unscheduled' });
    expect(r.dcExit.exitQuarter).toBeNull();
  });
});

describe('consolidation and DC exit', () => {
  it('retires a consolidated duplicate only after its primary has moved', () => {
    const r = plan([
      { id: 'D', sixR: 'retire', into: 'P' },
      { id: 'P', sixR: 'repurchase', pd: 800 },
    ]);
    expect(item(r, 'D').wave).toBe(3);
    expect(qi(r, 'D')).toBe(qi(r, 'P') + 1);
    expect(item(r, 'D').rationale.join(' ')).toContain('after Sys P is in place');
  });

  it('consolidates into an already-in-place primary in wave 1', () => {
    const r = plan([
      { id: 'D', sixR: 'retire', into: 'P' },
      { id: 'P', sixR: 'retain', hosting: 'saas' },
    ]);
    expect(item(r, 'D').wave).toBe(1);
    expect(item(r, 'D').quarter).toBe('2027Q1');
  });

  it('detects late systems and systems retained in the data center', () => {
    const r = plan(
      [
        { id: 'A', sixR: 'refactor', pd: 1000 },
        { id: 'K', sixR: 'retain' },
        { id: 'S', sixR: 'retain', siteBound: true },
        { id: 'C', sixR: 'retain', hosting: 'saas' },
      ],
      withRoadmap({ dcExitMilestone: '2027Q2' }),
    );
    expect(r.dcExit.achieved).toBe(false);
    expect(r.dcExit.inScope).toBe(2);
    expect(r.dcExit.violations).toEqual([
      { systemId: 'A', reason: 'late', quarter: '2027Q3' },
      { systemId: 'K', reason: 'retained_in_dc' },
    ]);
  });

  it('achieves DC exit when everything in scope leaves by the milestone', () => {
    const r = plan([
      { id: 'A', sixR: 'rehost' },
      { id: 'B', sixR: 'retire' },
      { id: 'S', sixR: 'retain', siteBound: true },
    ]);
    expect(r.dcExit).toMatchObject({ achieved: true, exitQuarter: '2027Q1', violations: [] });
  });

  it('converts to cost timing offsets', () => {
    const r = plan([{ id: 'A', sixR: 'refactor', pd: 1000 }]);
    const t = roadmapTiming(r, base);
    expect(t.systems.get('A')).toEqual({ start: 0, cutover: 2, bridgePersonDays: 0 });
    expect(t.dcExit).toBe(2);
  });
});

describe('roadmap on the real portfolio', () => {
  const { assessments, roadmap, cost } = assessPortfolio(portfolio, base);
  const byId = new Map(assessments.map((x) => [x.system.id, x]));
  const items = new Map(roadmap.items.map((i) => [i.systemId, i]));

  it('achieves the 2028Q4 data-center exit with default assumptions', () => {
    expect(roadmap.dcExit.violations).toEqual([]);
    expect(roadmap.dcExit.achieved).toBe(true);
    expect(quarterIndex(roadmap.dcExit.exitQuarter!)).toBeLessThanOrEqual(quarterIndex('2028Q4'));
    expect(roadmap.unscheduled).toEqual([]);
  });

  it('breaks the three planted cycles and leaves an acyclic plan', () => {
    const cyclic = new Set(roadmap.cyclesBroken.flatMap((c) => c.cycle));
    const names = [...cyclic].map((id) => byId.get(id)!.system.name).join('|');
    for (const n of ['SAP ECC', 'SAP PI/PO', 'Opcenter', 'KONFIG', 'Salesforce Sales Cloud', 'Manhattan WMS', 'Transporeon']) {
      expect(names).toContain(n);
    }
    const cut = new Set(roadmap.cyclesBroken.map((c) => `${c.cutEdge.from}>${c.cutEdge.to}`));
    const edges = new Map(portfolio.systems.map((s) => [s.id, s.integrations.filter((d) => !cut.has(`${s.id}>${d}`))]));
    expect(() => topologicalOrder(portfolio.systems.map((s) => s.id), edges)).not.toThrow();
  });

  it('respects capacity, dependency and consolidation constraints', () => {
    for (const q of roadmap.quarters) {
      expect(q.cutovers).toBeLessThanOrEqual(roadmap.capacity.maxCutoversPerQuarter);
      expect(q.personDays).toBeLessThanOrEqual(roadmap.capacity.maxPersonDaysPerQuarter + 1e-6);
    }
    for (const i of roadmap.items) {
      if (i.consolidateInto && items.has(i.consolidateInto)) {
        expect(quarterIndex(i.quarter)).toBeGreaterThan(quarterIndex(items.get(i.consolidateInto)!.quarter));
      }
      if (i.sixR === 'retire') continue;
      for (const dep of byId.get(i.systemId)!.system.integrations) {
        const d = items.get(dep);
        if (d && !i.temporaryIntegrations.includes(dep)) expect(quarterIndex(d.quarter)).toBeLessThanOrEqual(quarterIndex(i.quarter));
      }
    }
  });

  it('schedules every non-retained system and none of the retained ones', () => {
    for (const x of assessments) expect(items.has(x.system.id)).toBe(x.sixR.sixR !== 'retain');
  });

  it('feeds roadmap timing into a finite, positive business case', () => {
    expect(Number.isFinite(cost.npv)).toBe(true);
    expect(cost.npv).toBeGreaterThan(0);
    expect(cost.paybackQuarter).not.toBeNull();
    expect(cost.temporaryIntegrationCost).toBeGreaterThan(0);
  });

  it('recomputes the business case from slider overrides without moving the roadmap', () => {
    const slid = assessPortfolio(portfolio, withOverrides(base, { discountRate: 0.12, cloudRunCostFactor: 1.3, migrationCostMultiplier: 1.3 }));
    expect(slid.cost.npv).toBeLessThan(cost.npv);
    expect(slid.roadmap.items.map((i) => i.quarter)).toEqual(roadmap.items.map((i) => i.quarter));
  });

  it('attaches a rationale to every decision layer', () => {
    for (const x of assessments) {
      expect(x.time.rationale.length).toBeGreaterThan(0);
      expect(x.sixR.rationale.length).toBeGreaterThan(0);
      expect(x.cost.rationale.length).toBeGreaterThan(0);
      if (x.roadmap) expect(x.roadmap.rationale.length).toBeGreaterThan(0);
    }
  });
});
