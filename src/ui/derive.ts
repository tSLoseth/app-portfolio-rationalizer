import type { PortfolioAssessment } from '../engine/assess';
import { quarterIndex } from '../engine/quarters';
import type { Assumptions, Portfolio, SystemAssessment } from '../model/types';
import { nokM, pct } from './format';

export interface AiRationale {
  text: string;
  model: string;
}

const rationaleModules = import.meta.glob<{ default: Record<string, AiRationale> }>('../../data/rationale.json', {
  eager: true,
});
export const aiRationale: Record<string, AiRationale> = Object.values(rationaleModules)[0]?.default ?? {};

export interface Kpis {
  systems: number;
  runCost: number;
  onPremShare: number;
  duplicateGroups: number;
  duplicateSystems: number;
  npv: number;
  paybackYears: number | null;
  paybackQuarter: string | null;
  dcExitQuarter: string | null;
  dcAchieved: boolean;
  milestone: string;
}

export function kpis(p: Portfolio, r: PortfolioAssessment): Kpis {
  const groups = new Set(p.systems.map((s) => s.duplicateGroup).filter(Boolean));
  return {
    systems: p.systems.length,
    runCost: r.cost.baselineAnnual,
    onPremShare: p.systems.filter((s) => s.hosting === 'on_prem_dc').length / p.systems.length,
    duplicateGroups: groups.size,
    duplicateSystems: p.systems.filter((s) => s.duplicateGroup).length,
    npv: r.cost.npv,
    paybackYears: r.cost.paybackYears,
    paybackQuarter: r.cost.paybackQuarter,
    dcExitQuarter: r.roadmap.dcExit.exitQuarter,
    dcAchieved: r.roadmap.dcExit.achieved,
    milestone: r.roadmap.dcExit.milestone,
  };
}

export interface Finding {
  title: string;
  body: string;
}

const sum = (xs: SystemAssessment[], f: (a: SystemAssessment) => number) => xs.reduce((t, a) => t + f(a), 0);

export function headline(r: PortfolioAssessment): string {
  const c = r.cost;
  const exit = r.roadmap.dcExit;
  const exitPart = exit.exitQuarter ? `vacate the data center by ${exit.exitQuarter}` : 'work towards a data-center exit';
  const change = c.annualSaving >= 0 ? `cut annual IT run cost by ${nokM(c.annualSaving)} (${pct(c.annualSaving / c.baselineAnnual)})` : `raise annual IT run cost by ${nokM(-c.annualSaving)}`;
  return `Retire ${c.bySixR.retire.count} systems, migrate ${c.bySixR.rehost.count + c.bySixR.replatform.count + c.bySixR.refactor.count + c.bySixR.repurchase.count} and ${exitPart} to ${change}.`;
}

export function findings(r: PortfolioAssessment, a: Assumptions): Finding[] {
  const all = r.assessments;
  const c = r.cost;
  const out: Finding[] = [];

  const consolidations = all.filter((x) => x.sixR.sixR === 'retire' && x.sixR.consolidateInto);
  const consolidationSaving = sum(consolidations, (x) => x.cost.annualSaving);
  const plainRetire = all.filter((x) => x.sixR.sixR === 'retire' && !x.sixR.consolidateInto);
  const retireSaving = consolidationSaving + sum(plainRetire, (x) => x.cost.annualSaving);
  out.push({
    title: 'Post-merger consolidation carries the case',
    body:
      `${consolidations.length} duplicates retire into a group standard, saving ${nokM(consolidationSaving)} a year, ` +
      `${pct(Math.max(0, consolidationSaving) / Math.max(1, c.annualSaving))} of the total run-cost saving. ` +
      `Retirements overall (${consolidations.length + plainRetire.length} systems) account for ${nokM(retireSaving)}; ` +
      `they cost ${nokM(c.bySixR.retire.oneOffMigration)} one-off, the best ratio in the programme.`,
  });

  const moves = all.filter((x) => ['rehost', 'replatform', 'refactor', 'repurchase'].includes(x.sixR.sixR));
  const notSelfFunding = moves.filter((x) => x.cost.paybackYears === null || x.cost.paybackYears > c.horizonYears);
  const rp = c.bySixR.repurchase;
  const rpDelta = rp.targetAnnual - rp.baselineAnnual;
  const window = a.time.eolPenalty.windowYears.value;
  const eol = all.filter((x) => x.time.yearsToEol !== null && x.time.yearsToEol < window && x.sixR.sixR !== 'retire');
  const eolExpired = eol.filter((x) => (x.time.yearsToEol ?? 0) < 0).length;
  out.push({
    title: 'Cloud and SaaS moves are about risk, not savings',
    body:
      `${notSelfFunding.length} of ${moves.length} migrations have no simple payback within ${c.horizonYears} years on run cost alone. ` +
      `The ${rp.count} repurchases ${rpDelta >= 0 ? `add ${nokM(rpDelta)}` : `save ${nokM(-rpDelta)}`} a year in run cost, because subscriptions bundle hosting. ` +
      `They are justified by end-of-life exposure: ${eol.length} systems that stay in use run on platforms out of support within ${window} years (${eolExpired} already expired).`,
  });

  const exit = r.roadmap.dcExit;
  const ms = quarterIndex(exit.milestone);
  if (exit.exitQuarter) {
    const slack = ms - quarterIndex(exit.exitQuarter);
    const last = r.roadmap.items.filter((i) => i.dcScope && i.quarter === exit.exitQuarter);
    const byId = new Map(all.map((x) => [x.system.id, x.system.name]));
    const names = last.slice(0, 3).map((i) => byId.get(i.systemId)).join(', ');
    const peak = Math.max(...r.roadmap.quarters.map((q) => q.personDays));
    out.push({
      title: slack <= 0 ? 'The data-center exit has no slack' : `The data-center exit has ${slack} quarter${slack > 1 ? 's' : ''} of slack`,
      body:
        `All ${exit.inScope} in-scope systems leave by ${exit.exitQuarter} against a ${exit.milestone} lease deadline. ` +
        `Last to leave${last.length > 1 ? ` (${last.length})` : ''}: ${names}${last.length > 3 ? ' and others' : ''}. ` +
        `Delivery peaks at ${Math.round(peak).toLocaleString('en-US')} person-days in a quarter, ${pct(peak / r.roadmap.capacity.maxPersonDaysPerQuarter)} of capacity; ` +
        (slack <= 0
          ? 'any slippage on the critical path pushes systems past the lease.'
          : `a slip of more than ${slack} quarter${slack > 1 ? 's' : ''} breaches the lease.`),
    });
  } else {
    out.push({
      title: 'The data-center exit is not achieved',
      body: `${exit.violations.length} in-scope systems stay in the data center past ${exit.milestone}. The lease renewal, or more delivery capacity, must be priced in.`,
    });
  }
  return out;
}
