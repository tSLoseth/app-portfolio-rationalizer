import type {
  Assumptions,
  CostResult,
  PortfolioCostSummary,
  SixR,
  SixRResult,
  System,
  TargetCostBreakdown,
  WaterfallStep,
  YearCashFlow,
} from '../model/types';
import { buildGraph, degree, type IntegrationGraph } from './graph';
import { withOverrides } from './overrides';
import { quarterFromIndex, quarterIndex } from './quarters';

export const SIX_RS: SixR[] = ['rehost', 'replatform', 'refactor', 'repurchase', 'retire', 'retain'];
const CLOUD_MOVES: SixR[] = ['rehost', 'replatform', 'refactor'];

export const nok = (x: number) => {
  const abs = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}NOK ${(abs / 1e6).toFixed(2)}M`;
  return `${sign}NOK ${Math.round(abs / 1000)}k`;
};

export const baselineOf = (s: System) =>
  s.annualCost.license + s.annualCost.infra + s.annualCost.supportFte + s.annualCost.vendorSupport;

/** In scope for the data-center exit: hosted in the DC and not a plant/OT system. */
export const isDcScope = (s: System) => s.hosting === 'on_prem_dc' && !s.siteBound;

export function integrationMultiplier(s: System, g: IntegrationGraph, a: Assumptions): number {
  return Math.min(
    a.cost.integrationComplexityMaxMultiplier.value,
    1 + a.cost.integrationComplexityPerIntegration.value * degree(g, s.id),
  );
}

/** The group core ERP moving off its platform is costed as a programme, not with the 6R rate card. */
export const isErpProgramme = (s: System, sixR: SixR, a: Assumptions) =>
  sixR !== 'retire' &&
  sixR !== 'retain' &&
  s.capability.l2 === a.cost.erpProgrammeCapabilityL2.value &&
  a.cost.erpProgrammeSizeClasses.value.includes(s.sizeClass);

/** End-of-quarter discount factor for quarter k (0 = first programme quarter). */
export const discountFactor = (k: number, rate: number) => Math.pow(1 + rate, -(k + 1) / 4);

function targetBreakdown(s: System, r: SixRResult, a: Assumptions): TargetCostBreakdown {
  const c = s.annualCost;
  const cloud = a.cost.cloudRunCostMultiplier.value;
  const zero = { licenseAndVendor: 0, internalSupport: 0, keptInfra: 0, cloudRun: 0, consolidationUplift: 0 };
  switch (r.sixR) {
    case 'retain':
      return { ...zero, licenseAndVendor: c.license + c.vendorSupport, internalSupport: c.supportFte, keptInfra: c.infra };
    case 'retire':
      return r.consolidateInto
        ? { ...zero, consolidationUplift: a.cost.consolidationRunCostFactor.value * (c.license + c.vendorSupport) }
        : zero;
    case 'repurchase': {
      const subscription = Math.max(
        a.cost.repurchaseMinSubscriptionNok.value,
        a.cost.repurchaseSubscriptionFactor.value * (c.license + c.vendorSupport + c.infra),
      );
      return {
        ...zero,
        licenseAndVendor: a.cost.licenseFactor.value.repurchase * (c.license + c.vendorSupport),
        internalSupport: a.cost.supportFteFactor.value.repurchase * c.supportFte,
        cloudRun: subscription * cloud,
      };
    }
    default:
      return {
        ...zero,
        licenseAndVendor: a.cost.licenseFactor.value[r.sixR] * (c.license + c.vendorSupport),
        internalSupport: a.cost.supportFteFactor.value[r.sixR] * c.supportFte,
        cloudRun: a.cost.infraFactor.value[r.sixR] * c.infra * cloud,
      };
  }
}

const sumTarget = (t: TargetCostBreakdown) =>
  t.licenseAndVendor + t.internalSupport + t.keptInfra + t.cloudRun + t.consolidationUplift;

export function assessCost(s: System, r: SixRResult, g: IntegrationGraph, a: Assumptions): CostResult {
  const baselineAnnual = baselineOf(s);
  const target = targetBreakdown(s, r, a);
  const targetAnnual = sumTarget(target);
  const annualSaving = baselineAnnual - targetAnnual;
  const mult = integrationMultiplier(s, g, a);
  const price = a.cost.migrationCostMultiplier.value;
  const erp = isErpProgramme(s, r.sixR, a);
  const rate = a.cost.migrationCostNok.value[r.sixR][s.sizeClass];
  const consolidationRate = r.consolidateInto ? a.cost.consolidationCostNok.value[s.sizeClass] : 0;
  const moveNok = erp ? a.cost.erpProgrammeOneOffNok.value : rate * mult;
  const effortNok = moveNok + consolidationRate * mult;
  const migrationCost = moveNok * price;
  const consolidationCost = consolidationRate * mult * price;
  const oneOffMigration = migrationCost + consolidationCost;

  const paybackYears =
    annualSaving <= 0 ? null : oneOffMigration === 0 ? 0 : oneOffMigration / annualSaving;

  const quarters = a.cost.horizonYears.value * 4;
  const rateDisc = a.cost.discountRate.value;
  let npv = -oneOffMigration * discountFactor(0, rateDisc);
  for (let k = 1; k < quarters; k++) npv += (annualSaving / 4) * discountFactor(k, rateDisc);

  const rationale: string[] = [];
  rationale.push(`Baseline ${nok(baselineAnnual)}/yr → target ${nok(targetAnnual)}/yr (${r.sixR}); annual saving ${nok(annualSaving)}.`);
  if (CLOUD_MOVES.includes(r.sixR)) {
    rationale.push(
      `Target = licences × ${a.cost.licenseFactor.value[r.sixR]}, internal support × ${a.cost.supportFteFactor.value[r.sixR]}, ` +
        `infra × ${a.cost.infraFactor.value[r.sixR]} as cloud run cost (× cloud factor ${a.cost.cloudRunCostMultiplier.value}).`,
    );
  } else if (r.sixR === 'repurchase') {
    rationale.push(
      `SaaS subscription = max(${nok(a.cost.repurchaseMinSubscriptionNok.value)}, ${a.cost.repurchaseSubscriptionFactor.value} × today's licence + vendor support + infra) ` +
        `× cloud factor ${a.cost.cloudRunCostMultiplier.value} = ${nok(target.cloudRun)}; internal support × ${a.cost.supportFteFactor.value.repurchase}.`,
    );
  } else if (r.sixR === 'retire' && r.consolidateInto) {
    rationale.push(
      `Consolidation uplift on the primary: ${a.cost.consolidationRunCostFactor.value} × licence + vendor support = ${nok(target.consolidationUplift)}/yr.`,
    );
  }
  if (erp) {
    rationale.push(
      `One-off ${nok(oneOffMigration)} = ERP programme estimate ${nok(a.cost.erpProgrammeOneOffNok.value)} × price factor ${price} ` +
        `(replaces the ${r.sixR} ${s.sizeClass} rate card, which would give ${nok(rate * mult * price)}; interfaces are inside the programme).`,
    );
  } else if (oneOffMigration > 0) {
    rationale.push(
      `One-off ${nok(oneOffMigration)} = (${r.sixR} ${s.sizeClass} ${nok(rate)}` +
        `${consolidationRate ? ` + consolidation ${nok(consolidationRate)}` : ''}) × integration multiplier ${mult.toFixed(2)} ` +
        `(${degree(g, s.id)} integrations) × price factor ${price}.`,
    );
  }
  rationale.push(
    r.sixR === 'retain' && oneOffMigration === 0 && annualSaving === 0
      ? 'Retained as-is: no one-off cost and no run-cost change, so no payback applies.'
      : paybackYears === null
        ? 'No simple payback on run cost (the annual saving is not positive); the move rests on end-of-life, risk or data-center-exit grounds, not on savings.'
        : `Simple payback (one-off ÷ annual saving): ${paybackYears.toFixed(1)} years.`,
  );

  return {
    systemId: s.id,
    sixR: r.sixR,
    baselineAnnual,
    target,
    targetAnnual,
    annualSaving,
    integrationMultiplier: mult,
    migrationCost,
    consolidationCost,
    oneOffMigration,
    migrationPersonDays: effortNok / a.cost.dayRateNok.value,
    ...(erp ? { erpProgramme: true } : {}),
    paybackYears,
    npv,
    rationale,
  };
}

export function assessCosts(
  systems: System[],
  sixRs: SixRResult[],
  a: Assumptions,
  g: IntegrationGraph = buildGraph(systems),
): CostResult[] {
  const byId = new Map(sixRs.map((r) => [r.systemId, r]));
  return systems.map((s) => assessCost(s, byId.get(s.id)!, g, a));
}

// ---- Portfolio: timing, cash flows, NPV ----

/** Quarter offsets from the programme start quarter. */
export interface SystemTiming {
  start: number;
  cutover: number;
  bridgePersonDays: number;
}

export interface CostTiming {
  systems: Map<string, SystemTiming>;
  /** Quarter offset in which the last DC system leaves; null = DC is never vacated. */
  dcExit: number | null;
}

/** Everything cut over in the first quarter; used before a roadmap exists. */
export function immediateTiming(systems: System[], sixRs: SixRResult[]): CostTiming {
  const byId = new Map(sixRs.map((r) => [r.systemId, r]));
  const timing = new Map<string, SystemTiming>();
  for (const s of systems) if (byId.get(s.id)!.sixR !== 'retain') timing.set(s.id, { start: 0, cutover: 0, bridgePersonDays: 0 });
  const dcStays = systems.some((s) => isDcScope(s) && !timing.has(s.id));
  return { systems: timing, dcExit: dcStays ? null : 0 };
}

interface QuarterFlows {
  investment: number[];
  saving: number[];
}

const PAYBACK_SEARCH_QUARTERS = 60;

function quarterlyFlows(costs: CostResult[], timing: CostTiming, a: Assumptions, n: number): QuarterFlows {
  const investment = new Array<number>(n).fill(0);
  const saving = new Array<number>(n).fill(0);
  const bridgeRate = a.cost.dayRateNok.value * a.cost.migrationCostMultiplier.value;
  for (const c of costs) {
    const t = timing.systems.get(c.systemId);
    if (!t) continue;
    const span = t.cutover - t.start + 1;
    for (let k = t.start; k <= t.cutover && k < n; k++) investment[k]! += c.oneOffMigration / span;
    if (t.cutover < n) investment[t.cutover]! += t.bridgePersonDays * bridgeRate;
    for (let k = t.cutover + 1; k < n; k++) saving[k]! += c.annualSaving / 4;
  }
  if (timing.dcExit !== null) {
    for (let k = timing.dcExit + 1; k < n; k++) saving[k]! += a.cost.dataCenterAnnualFixedCostNok.value / 4;
  }
  return { investment, saving };
}

export function npvOf(costs: CostResult[], timing: CostTiming, a: Assumptions): number {
  const n = a.cost.horizonYears.value * 4;
  const { investment, saving } = quarterlyFlows(costs, timing, a, n);
  let npv = 0;
  for (let k = 0; k < n; k++) npv += (saving[k]! - investment[k]!) * discountFactor(k, a.cost.discountRate.value);
  return npv;
}

function buildWaterfall(systems: System[], costs: CostResult[], facility: number, dcExited: boolean): WaterfallStep[] {
  const byId = new Map(systems.map((s) => [s.id, s]));
  let baseline = facility;
  let retire = 0;
  let rightsizing = 0;
  let infraExit = dcExited ? -facility : 0;
  let cloudRun = 0;
  for (const c of costs) {
    const s = byId.get(c.systemId)!;
    const ac = s.annualCost;
    baseline += c.baselineAnnual;
    if (c.sixR === 'retire') retire += c.target.consolidationUplift - c.baselineAnnual;
    else if (c.sixR !== 'retain') {
      rightsizing += c.target.licenseAndVendor + c.target.internalSupport - (ac.license + ac.vendorSupport + ac.supportFte);
      infraExit -= ac.infra;
      cloudRun += c.target.cloudRun;
    }
  }
  const target = baseline + retire + rightsizing + infraExit + cloudRun;
  return [
    { key: 'baseline', label: 'Baseline run cost (incl. DC facility)', value: baseline },
    { key: 'retire', label: 'Retire & consolidate (net)', value: retire },
    { key: 'rightsizing', label: 'Rightsizing: licences & internal support', value: rightsizing },
    { key: 'infraExit', label: 'Current infra & DC facility removed', value: infraExit },
    { key: 'cloudRun', label: 'Cloud run cost & SaaS subscriptions added', value: cloudRun },
    { key: 'target', label: 'Target run cost', value: target },
  ];
}

export function summarizePortfolioCost(
  systems: System[],
  sixRs: SixRResult[],
  a: Assumptions,
  timing: CostTiming = immediateTiming(systems, sixRs),
  g: IntegrationGraph = buildGraph(systems),
): PortfolioCostSummary {
  const costs = assessCosts(systems, sixRs, a, g);
  const facility = a.cost.dataCenterAnnualFixedCostNok.value;
  const dcExited = timing.dcExit !== null;
  const systemsBaselineAnnual = costs.reduce((x, c) => x + c.baselineAnnual, 0);
  const baselineAnnual = systemsBaselineAnnual + facility;
  const targetAnnual = costs.reduce((x, c) => x + c.targetAnnual, 0) + (dcExited ? 0 : facility);
  const annualSaving = baselineAnnual - targetAnnual;
  let bridgeDays = 0;
  for (const t of timing.systems.values()) bridgeDays += t.bridgePersonDays;
  const temporaryIntegrationCost = bridgeDays * a.cost.dayRateNok.value * a.cost.migrationCostMultiplier.value;
  const oneOffMigration = costs.reduce((x, c) => x + c.oneOffMigration, 0) + temporaryIntegrationCost;
  const paybackYears = annualSaving <= 0 ? null : oneOffMigration / annualSaving;

  const horizonQuarters = a.cost.horizonYears.value * 4;
  const rate = a.cost.discountRate.value;
  const n = Math.max(horizonQuarters, PAYBACK_SEARCH_QUARTERS);
  const flows = quarterlyFlows(costs, timing, a, n);
  const startIdx = quarterIndex(a.roadmap.startQuarter.value);
  const startYear = Math.floor(startIdx / 4);

  let cumulative = 0;
  let wentNegative = false;
  let paybackQuarter: PortfolioCostSummary['paybackQuarter'] = null;
  for (let k = 0; k < n; k++) {
    cumulative += flows.saving[k]! - flows.investment[k]!;
    if (cumulative < 0) wentNegative = true;
    else if (paybackQuarter === null && (wentNegative || k === 0)) {
      paybackQuarter = quarterFromIndex(startIdx + k);
      break;
    }
  }

  const cashFlows: YearCashFlow[] = [];
  let cumDisc = 0;
  for (let y = 0; y < a.cost.horizonYears.value; y++) {
    let investment = 0;
    let saving = 0;
    let discounted = 0;
    for (let k = y * 4; k < y * 4 + 4; k++) {
      investment += flows.investment[k]!;
      saving += flows.saving[k]!;
      discounted += (flows.saving[k]! - flows.investment[k]!) * discountFactor(k, rate);
    }
    cumDisc += discounted;
    cashFlows.push({ year: startYear + y, investment, saving, net: saving - investment, discounted, cumulative: cumDisc });
  }
  const npv = cumDisc;

  const bySixR = Object.fromEntries(
    SIX_RS.map((r) => [r, { count: 0, baselineAnnual: 0, targetAnnual: 0, oneOffMigration: 0 }]),
  ) as PortfolioCostSummary['bySixR'];
  for (const c of costs) {
    const b = bySixR[c.sixR];
    b.count++;
    b.baselineAnnual += c.baselineAnnual;
    b.targetAnnual += c.targetAnnual;
    b.oneOffMigration += c.oneOffMigration;
  }

  const range = a.cost.sensitivityRange.value;
  const c0 = a.cost.cloudRunCostMultiplier.value;
  const m0 = a.cost.migrationCostMultiplier.value;
  const npvAt = (cloud: number, mig: number) => {
    const scenario = withOverrides(a, { cloudRunCostFactor: cloud, migrationCostMultiplier: mig });
    return npvOf(assessCosts(systems, sixRs, scenario, g), timing, scenario);
  };
  const levels = [1 - range, 1, 1 + range];
  const grid = levels.flatMap((fc) =>
    levels.map((fm) => ({ cloudRunCostFactor: c0 * fc, migrationCostMultiplier: m0 * fm, npv: fc === 1 && fm === 1 ? npv : npvAt(c0 * fc, m0 * fm) })),
  );
  const at = (fc: number, fm: number) => grid.find((x) => x.cloudRunCostFactor === c0 * fc && x.migrationCostMultiplier === m0 * fm)!.npv;
  const npvs = grid.map((x) => x.npv);

  return {
    baselineAnnual,
    systemsBaselineAnnual,
    dataCenterFacilityAnnual: facility,
    targetAnnual,
    annualSaving,
    oneOffMigration,
    temporaryIntegrationCost,
    paybackYears,
    paybackQuarter,
    npv,
    discountRate: rate,
    horizonYears: a.cost.horizonYears.value,
    cashFlows,
    waterfall: buildWaterfall(systems, costs, facility, dcExited),
    bySixR,
    sensitivity: {
      grid,
      tornado: [
        { parameter: 'Cloud run cost', lowInput: c0 * (1 - range), highInput: c0 * (1 + range), npvAtLow: at(1 - range, 1), npvAtHigh: at(1 + range, 1) },
        { parameter: 'Migration cost', lowInput: m0 * (1 - range), highInput: m0 * (1 + range), npvAtLow: at(1, 1 - range), npvAtHigh: at(1, 1 + range) },
      ],
      npvMin: Math.min(...npvs),
      npvMax: Math.max(...npvs),
    },
  };
}
