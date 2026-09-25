import type {
  Assumptions,
  BrokenCycle,
  CostResult,
  Horizon,
  Quarter,
  RoadmapItem,
  RoadmapResult,
  SixR,
  SixRResult,
  System,
  Wave,
} from '../model/types';
import type { CostTiming, SystemTiming } from './cost';
import { isDcScope } from './cost';
import { buildGraph, degree, stronglyConnected, topologicalOrder, type IntegrationGraph } from './graph';
import { quarterFromIndex, quarterIndex } from './quarters';

const WAVES: Wave[] = [0, 1, 2, 3];

/** Migration tracks: a track sets scheduling priority by migration type, not a calendar period. */
export const TRACK_NAME: Record<Wave, string> = {
  0: 'Retire track',
  1: 'Rehost & consolidation track',
  2: 'Replatform track',
  3: 'Refactor & repurchase track',
};

export const HORIZON_NAME: Record<Horizon, string> = {
  H1: 'Quick wins',
  H2: 'Transform and exit',
  H3: 'Close-out',
};

/** Calendar horizon of a quarter, from the presentation boundaries in assumptions. */
export function horizonOf(q: Quarter, a: Assumptions): Horizon {
  const ends = a.roadmap.horizonEnds.value;
  const i = quarterIndex(q);
  return i <= quarterIndex(ends.H1) ? 'H1' : i <= quarterIndex(ends.H2) ? 'H2' : 'H3';
}

function baseWave(sixR: SixR, a: Assumptions): Wave {
  for (const w of WAVES) if (a.roadmap.waves.value[String(w) as '0' | '1' | '2' | '3'].includes(sixR)) return w;
  throw new Error(`No wave configured for ${sixR}`);
}

interface WaveAssignment {
  wave: Wave;
  reason: string;
}

export function assignWaves(
  systems: System[],
  sixRs: Map<string, SixRResult>,
  g: IntegrationGraph,
  a: Assumptions,
  nameOf: (id: string) => string,
): Map<string, WaveAssignment> {
  const out = new Map<string, WaveAssignment>();
  const moving = systems.filter((s) => sixRs.get(s.id)!.sixR !== 'retain');
  const consolidations = moving.filter((s) => sixRs.get(s.id)!.consolidateInto);
  for (const s of moving) {
    const r = sixRs.get(s.id)!;
    if (r.consolidateInto) continue;
    if (r.sixR === 'retire') {
      const n = g.dependents.get(s.id)?.length ?? 0;
      const max = a.roadmap.retireQuickWinMaxDependants.value;
      out.set(
        s.id,
        n <= max
          ? { wave: 0, reason: `${TRACK_NAME[0]}, quick win: plain retirement with ${n} dependant(s) (≤ ${max}).` }
          : { wave: 1, reason: `${TRACK_NAME[1]}: retirement with ${n} dependants (> ${max}) needs consumers re-pointed first.` },
      );
    } else if (r.sixR === 'rehost') {
      const n = degree(g, s.id);
      const max = a.roadmap.rehostWaveMaxIntegrations.value;
      out.set(
        s.id,
        n <= max
          ? { wave: baseWave('rehost', a), reason: `${TRACK_NAME[baseWave('rehost', a)]}: rehost with ${n} integration(s) (≤ ${max}).` }
          : { wave: 2, reason: `${TRACK_NAME[2]}: rehost with ${n} integrations (> ${max}) is not a low-risk first move.` },
      );
    } else {
      const w = baseWave(r.sixR, a);
      out.set(s.id, { wave: w, reason: `${TRACK_NAME[w]}: ${r.sixR}.` });
    }
  }
  for (const s of consolidations) {
    const p = sixRs.get(s.id)!.consolidateInto!;
    const pw = out.get(p);
    out.set(
      s.id,
      pw
        ? {
            wave: Math.max(1, pw.wave) as Wave,
            reason: `${TRACK_NAME[Math.max(1, pw.wave) as Wave]}: consolidation into ${nameOf(p)}, which itself moves in the ${TRACK_NAME[pw.wave].toLowerCase()}.`,
          }
        : { wave: 1, reason: `${TRACK_NAME[1]}: consolidation into ${nameOf(p)}, which is already in place.` },
    );
  }
  return out;
}

/**
 * A retirement that is a plain switch-off: not in the data center, not a consolidation, and any
 * dependants are SaaS tools whose connector is simply disabled (no interface to re-engineer).
 */
export function isLightRetirement(s: System, r: SixRResult, g: IntegrationGraph, byId: Map<string, System>): boolean {
  if (r.sixR !== 'retire' || r.consolidateInto || isDcScope(s)) return false;
  return (g.dependents.get(s.id) ?? []).every((d) => byId.get(d)?.hosting === 'saas');
}

const edgeKey =(from: string, to: string) => `${from}→${to}`;

function findPath(edges: Map<string, string[]>, from: string, to: string): string[] | null {
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === to) {
      const path = [to];
      while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
      return path;
    }
    for (const m of [...(edges.get(n) ?? [])].sort()) if (!prev.has(m)) (prev.set(m, n), queue.push(m));
  }
  return null;
}

export const CYCLE_RULE =
  'Cut the edge that is cheapest to bridge: prefer an edge touching a retained system (no bridge needed), ' +
  'then the lowest-criticality dependency, then the dependency in the latest migration track; ties by system id.';

/**
 * Breaks every dependency cycle by repeatedly cutting one edge inside a strongly connected
 * component, chosen by CYCLE_RULE. Consolidation edges are never cut.
 */
export function breakCycles(
  nodes: string[],
  edges: Map<string, string[]>,
  uncuttable: Set<string>,
  rank: (from: string, to: string) => (number | string)[],
): { edges: Map<string, string[]>; cuts: { from: string; to: string; cycle: string[] }[] } {
  const work = new Map([...edges].map(([k, v]) => [k, [...v]]));
  const cuts: { from: string; to: string; cycle: string[] }[] = [];
  for (;;) {
    const sccs = stronglyConnected(nodes, work);
    if (sccs.length === 0) return { edges: work, cuts };
    const scc = new Set(sccs[0]!);
    let candidates: [string, string][] = [];
    for (const from of scc) for (const to of work.get(from) ?? []) if (scc.has(to)) candidates.push([from, to]);
    const cuttable = candidates.filter(([f, t]) => !uncuttable.has(edgeKey(f, t)));
    if (cuttable.length) candidates = cuttable;
    const cmp = (x: (number | string)[], y: (number | string)[]) => {
      for (let i = 0; i < x.length; i++) {
        if (x[i] === y[i]) continue;
        return typeof x[i] === 'number' ? (x[i] as number) - (y[i] as number) : String(x[i]).localeCompare(String(y[i]));
      }
      return 0;
    };
    candidates.sort((x, y) => cmp(rank(...x), rank(...y)));
    const [from, to] = candidates[0]!;
    const cycle = [from, ...(findPath(work, to, from) ?? [to, from])];
    work.set(from, work.get(from)!.filter((d) => d !== to));
    cuts.push({ from, to, cycle });
  }
}

export function planRoadmap(
  systems: System[],
  sixRList: SixRResult[],
  costList: CostResult[],
  a: Assumptions,
  g: IntegrationGraph = buildGraph(systems),
): RoadmapResult {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const sixRs = new Map(sixRList.map((r) => [r.systemId, r]));
  const costs = new Map(costList.map((c) => [c.systemId, c]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const retained = systems.filter((s) => sixRs.get(s.id)!.sixR === 'retain').map((s) => s.id);
  const retainedSet = new Set(retained);
  const waves = assignWaves(systems, sixRs, g, a, nameOf);

  const ids = systems.map((s) => s.id);
  const edges = new Map(ids.map((id) => [id, [...(g.dependencies.get(id) ?? [])]]));
  const uncuttable = new Set<string>();
  for (const r of sixRList) {
    if (!r.consolidateInto) continue;
    const list = edges.get(r.systemId)!;
    if (!list.includes(r.consolidateInto)) list.push(r.consolidateInto);
    uncuttable.add(edgeKey(r.systemId, r.consolidateInto));
  }
  const { edges: dag, cuts } = breakCycles(ids, edges, uncuttable, (from, to) => [
    retainedSet.has(from) || retainedSet.has(to) ? 0 : 1,
    byId.get(to)!.businessCriticality,
    -(waves.get(to)?.wave ?? -1),
    to,
    from,
  ]);
  const topo = new Map(topologicalOrder(ids, dag).map((id, i) => [id, i]));

  const startIdx = quarterIndex(a.roadmap.startQuarter.value);
  const nQ = quarterIndex(a.roadmap.endQuarter.value) - startIdx + 1;
  const maxCutovers = a.roadmap.maxSystemsPerQuarter.value;
  const maxLight = a.roadmap.maxLightRetirementsPerQuarter.value;
  const erpDuration = a.roadmap.erpProgrammeDurationQuarters.value;
  const erpShare = a.roadmap.erpProgrammeSharedCapacityShare.value;
  const maxPd = a.roadmap.maxPersonDaysPerQuarter.value;
  const perSystem = a.roadmap.maxPersonDaysPerSystemPerQuarter.value;
  const bridgeDays = a.roadmap.temporaryIntegrationPersonDays.value;
  const load = new Array<number>(nQ).fill(0);
  const cutovers = new Array<number>(nQ).fill(0);
  const lightCount = new Array<number>(nQ).fill(0);
  const byWave = Array.from({ length: nQ }, () => ({ 0: 0, 1: 0, 2: 0, 3: 0 }) as Record<Wave, number>);
  const q = (offset: number) => quarterFromIndex(startIdx + offset);

  // DC-exit systems (and the primaries they consolidate into) get capacity first: the lease
  // expiry is the hard constraint, everything else can fill the remaining slots.
  const dcFirst = new Set(systems.filter(isDcScope).map((s) => s.id));
  for (const id of [...dcFirst]) {
    let p = sixRs.get(id)?.consolidateInto;
    while (p && !dcFirst.has(p)) {
      dcFirst.add(p);
      p = sixRs.get(p)?.consolidateInto;
    }
  }
  const rank = (id: string) => (dcFirst.has(id) ? 0 : 1);
  const order = [...waves.keys()].sort(
    (x, y) => rank(x) - rank(y) || waves.get(x)!.wave - waves.get(y)!.wave || topo.get(x)! - topo.get(y)!,
  );
  const placed = new Map<string, SystemTiming>();
  const items: RoadmapItem[] = [];
  const unscheduled: string[] = [];

  for (const id of order) {
    const s = byId.get(id)!;
    const r = sixRs.get(id)!;
    const w = waves.get(id)!;
    const migrationPersonDays = costs.get(id)!.migrationPersonDays;
    const erp = costs.get(id)!.erpProgramme === true;
    const light = isLightRetirement(s, r, g, byId);
    const duration = erp ? erpDuration : Math.max(1, Math.ceil(migrationPersonDays / perSystem));
    const perQuarter = ((erp ? erpShare : 1) * migrationPersonDays) / duration;
    const rationale = [
      w.reason,
      ...(light
        ? [
            `Light retirement: outside the data center, not a consolidation and no dependants beyond SaaS connectors, so it is a switch-off that uses the separate light-retirement capacity (≤ ${maxLight} per quarter), not a cutover slot.`,
          ]
        : []),
      dcFirst.has(id)
        ? 'Scheduling priority: DC-exit critical, placed before systems without a hard deadline.'
        : 'Scheduling priority: no hard deadline, fills capacity left after DC-exit systems.',
    ];
    let earliest = duration - 1;
    const bridges: string[] = [];

    if (r.sixR !== 'retire') {
      for (const dep of [...(g.dependencies.get(id) ?? [])].sort()) {
        if (retainedSet.has(dep)) continue;
        const t = placed.get(dep);
        if (t) {
          if (t.cutover > earliest) rationale.push(`Waits for dependency ${nameOf(dep)} (cutover ${q(t.cutover)}).`);
          earliest = Math.max(earliest, t.cutover);
        } else bridges.push(dep);
      }
    }
    let blocked = false;
    if (r.consolidateInto && !retainedSet.has(r.consolidateInto)) {
      const t = placed.get(r.consolidateInto);
      if (!t) blocked = true;
      else {
        earliest = Math.max(earliest, t.cutover + 1);
        rationale.push(
          r.consolidationTargetFuture
            ? `Consolidation: scheduled after the group standard's future state goes live (${nameOf(r.consolidateInto)} → ${r.consolidationTargetFuture.futureState}, cutover ${q(t.cutover)}).`
            : `Consolidation: scheduled after ${nameOf(r.consolidateInto)} is in place (cutover ${q(t.cutover)}).`,
        );
      }
    }
    const bridgePersonDays = bridges.length * bridgeDays;

    let cutover = -1;
    for (let c = earliest; c < nQ && !blocked; c++) {
      if (light ? lightCount[c]! >= maxLight : cutovers[c]! - lightCount[c]! >= maxCutovers) continue;
      let fits = true;
      for (let k = c - duration + 1; k <= c; k++) {
        if (load[k]! + perQuarter + (k === c ? bridgePersonDays : 0) > maxPd + 1e-9) fits = false;
      }
      if (fits) {
        cutover = c;
        break;
      }
    }
    if (cutover < 0) {
      unscheduled.push(id);
      continue;
    }
    const start = cutover - duration + 1;
    for (let k = start; k <= cutover; k++) load[k]! += perQuarter;
    load[cutover]! += bridgePersonDays;
    cutovers[cutover]!++;
    if (light) lightCount[cutover]!++;
    byWave[cutover]![w.wave]++;
    placed.set(id, { start, cutover, bridgePersonDays });

    rationale.push(
      erp
        ? `ERP programme: dedicated team over ${duration} quarters, ${q(start)}–${q(cutover)}; ${Math.round(erpShare * 100)} % of its ${Math.round(migrationPersonDays)} person-days (${Math.round(perQuarter)} per quarter) draws on the shared migration pool.`
        : `Effort ${Math.round(migrationPersonDays)} person-days over ${duration} quarter(s) (≤ ${perSystem} per system per quarter): ${q(start)}–${q(cutover)}.`,
    );
    if (cutover > earliest) rationale.push(`Capacity limits pushed cutover from ${q(earliest)} to ${q(cutover)}.`);
    if (bridges.length) {
      rationale.push(
        `Temporary integration to ${bridges.map(nameOf).join(', ')} (${bridges.length} × ${bridgeDays} person-days): they move later.`,
      );
    }
    const horizon = horizonOf(q(cutover), a);
    rationale.push(`Calendar horizon: ${horizon} (${HORIZON_NAME[horizon].toLowerCase()}), cutover ${q(cutover)}.`);
    const dcScope = isDcScope(s);
    if (dcScope) {
      const ok = startIdx + cutover <= quarterIndex(a.roadmap.dcExitMilestone.value);
      rationale.push(`DC-exit scope: leaves the data center in ${q(cutover)} (${ok ? 'before' : 'AFTER'} milestone ${a.roadmap.dcExitMilestone.value}).`);
    }
    items.push({
      systemId: id,
      wave: w.wave,
      horizon,
      sixR: r.sixR,
      startQuarter: q(start),
      quarter: q(cutover),
      durationQuarters: duration,
      personDays: migrationPersonDays + bridgePersonDays,
      migrationPersonDays,
      bridgePersonDays,
      temporaryIntegrations: bridges,
      ...(r.consolidateInto ? { consolidateInto: r.consolidateInto } : {}),
      dcScope,
      lightRetirement: light,
      erpProgramme: erp,
      rationale,
    });
  }

  const itemById = new Map(items.map((i) => [i.systemId, i]));
  const cyclesBroken: BrokenCycle[] = cuts.map(({ from, to, cycle }) => {
    const bridged = itemById.get(from)?.temporaryIntegrations.includes(to) ?? false;
    return { cycle, cutEdge: { from, to }, rule: CYCLE_RULE, temporaryIntegration: bridged, personDays: bridged ? bridgeDays : 0 };
  });

  const milestone = a.roadmap.dcExitMilestone.value;
  const violations: RoadmapResult['dcExit']['violations'] = [];
  let lastExit = -1;
  const inScope = systems.filter(isDcScope);
  for (const s of inScope) {
    const item = itemById.get(s.id);
    if (retainedSet.has(s.id)) violations.push({ systemId: s.id, reason: 'retained_in_dc' });
    else if (!item) violations.push({ systemId: s.id, reason: 'unscheduled' });
    else {
      const idx = quarterIndex(item.quarter);
      lastExit = Math.max(lastExit, idx);
      if (idx > quarterIndex(milestone)) violations.push({ systemId: s.id, reason: 'late', quarter: item.quarter });
    }
  }
  const allLeave = !violations.some((v) => v.reason !== 'late');
  const exitQuarter: Quarter | null = allLeave ? (lastExit >= 0 ? quarterFromIndex(lastExit) : a.roadmap.startQuarter.value) : null;

  return {
    items: items.sort((x, y) => quarterIndex(x.quarter) - quarterIndex(y.quarter) || x.wave - y.wave || x.systemId.localeCompare(y.systemId)),
    quarters: load.map((pd, k) => ({ quarter: q(k), cutovers: cutovers[k]!, lightRetirements: lightCount[k]!, personDays: pd, byWave: byWave[k]! })),
    cyclesBroken,
    dcExit: { milestone, achieved: violations.length === 0, exitQuarter, inScope: inScope.length, violations },
    retained,
    unscheduled,
    capacity: {
      maxCutoversPerQuarter: maxCutovers,
      maxLightRetirementsPerQuarter: maxLight,
      maxPersonDaysPerQuarter: maxPd,
      maxPersonDaysPerSystemPerQuarter: perSystem,
    },
  };
}

/** Converts the roadmap into quarter offsets for the cost model's cash-flow timing. */
export function roadmapTiming(roadmap: RoadmapResult, a: Assumptions): CostTiming {
  const startIdx = quarterIndex(a.roadmap.startQuarter.value);
  const systems = new Map<string, SystemTiming>();
  for (const i of roadmap.items) {
    systems.set(i.systemId, {
      start: quarterIndex(i.startQuarter) - startIdx,
      cutover: quarterIndex(i.quarter) - startIdx,
      bridgePersonDays: i.bridgePersonDays,
    });
  }
  const exit = roadmap.dcExit.exitQuarter;
  return { systems, dcExit: exit === null ? null : quarterIndex(exit) - startIdx };
}
