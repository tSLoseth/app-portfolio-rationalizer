import type { Assumptions, CapabilityDef, SixR, SixRFlag, SixRResult, System, TimeResult } from '../model/types';
import { capabilityKey } from '../model/types';
import { atLeast, fmt } from './time';
import { buildGraph, degree, type IntegrationGraph } from './graph';

const MOVES_TO_CLOUD: SixR[] = ['rehost', 'replatform', 'refactor', 'repurchase'];

export function isLowComplexity(s: System, g: IntegrationGraph, a: Assumptions): boolean {
  return (
    a.sixR.lowComplexitySizeClasses.value.includes(s.sizeClass) &&
    degree(g, s.id) <= a.sixR.lowComplexityMaxIntegrations.value
  );
}

export function assessSixR(
  s: System,
  time: TimeResult,
  capability: CapabilityDef | undefined,
  g: IntegrationGraph,
  a: Assumptions,
  nameOf: (id: string) => string = (id) => id,
): SixRResult {
  const rationale: string[] = [];
  const flags: SixRFlag[] = [];
  const cat = time.category;
  const onPremDc = s.hosting === 'on_prem_dc';
  const ints = degree(g, s.id);
  const complexity = `size ${s.sizeClass}, ${ints} integration(s)`;
  let sixR: SixR;

  if (s.siteBound) {
    sixR = 'retain';
    flags.push('site_bound');
    rationale.push(
      `Site-bound plant/OT system: stays at the plant and is not part of the data-center exit → retain. ` +
        `TIME category ${cat} is handed to the plant OT roadmap${cat === 'eliminate' || cat === 'migrate' ? ' as a follow-up action' : ''}.`,
    );
  } else if (cat === 'eliminate') {
    sixR = 'retire';
    if (time.consolidateInto) {
      flags.push('consolidation');
      rationale.push(
        `Eliminate → retire by consolidating data, users and interfaces into ${nameOf(time.consolidateInto)}; not a free switch-off.`,
      );
    } else {
      rationale.push('Eliminate → retire: archive data, switch off and cancel licences.');
    }
  } else if (cat === 'tolerate') {
    if (!onPremDc) {
      sixR = 'retain';
      rationale.push(`Tolerate and already off the data center (${s.hosting}) → retain as-is.`);
    } else if (isLowComplexity(s, g, a)) {
      sixR = 'rehost';
      rationale.push(
        `Tolerate + on-prem + low complexity (${complexity}; limits ${a.sixR.lowComplexitySizeClasses.value.join('/')} and ≤ ${a.sixR.lowComplexityMaxIntegrations.value}) → rehost.`,
      );
    } else {
      sixR = 'rehost';
      flags.push('dc_exit_forced');
      rationale.push(
        `Tolerate + on-prem but not low complexity (${complexity}) would normally be retained, but the data center closes → ` +
          `forced rehost as the cheapest exit, with extra integration testing.`,
      );
    }
  } else if (cat === 'migrate') {
    if (capability?.saasAlternative) {
      sixR = 'repurchase';
      rationale.push(
        `Migrate + a credible SaaS/COTS alternative exists for ${capability.l2}` +
          `${capability.saasAlternativeExample ? ` (e.g. ${capability.saasAlternativeExample})` : ''} → repurchase.`,
      );
    } else if (s.type === 'custom' && atLeast(time.businessValue, a.sixR.refactorMinBusinessValue.value)) {
      sixR = 'refactor';
      rationale.push(
        `Migrate + custom-built + business value ${fmt(time.businessValue)} ≥ ${fmt(a.sixR.refactorMinBusinessValue.value)} and no SaaS alternative → refactor.`,
      );
    } else if (s.hosting === 'saas') {
      sixR = 'retain';
      rationale.push('Migrate, but already SaaS with no alternative on the market → retain and escalate with the vendor.');
    } else {
      sixR = 'replatform';
      rationale.push(
        `Migrate without SaaS alternative and ${s.type === 'custom' ? `business value ${fmt(time.businessValue)} below refactor threshold ${fmt(a.sixR.refactorMinBusinessValue.value)}` : `${s.type.toUpperCase()} product`} → replatform.`,
      );
    }
  } else if (onPremDc) {
    const large = a.sixR.investRefactorSizeClasses.value.includes(s.sizeClass);
    if (large && s.type === 'custom') {
      sixR = 'refactor';
      rationale.push(`Invest + on-prem + size ${s.sizeClass} custom system → refactor to cloud-native.`);
    } else {
      sixR = 'replatform';
      rationale.push(
        large
          ? `Invest + on-prem + size ${s.sizeClass}, but a ${s.type.toUpperCase()} product cannot be refactored by the client → replatform onto the vendor's cloud/managed edition.`
          : `Invest + on-prem + size ${s.sizeClass} → replatform onto a managed platform.`,
      );
    }
  } else {
    sixR = 'retain';
    rationale.push(`Invest and already on ${s.hosting} → retain and keep investing.`);
  }

  const residency =
    s.residencyRequired || s.dataSensitivity === a.sixR.residencyFlagSensitivity.value;
  if (residency && MOVES_TO_CLOUD.includes(sixR)) {
    flags.push('requires_eu_no_region');
    rationale.push(
      `Data residency: ${s.dataSensitivity} data${s.residencyRequired ? ' with a residency requirement' : ''} → target must run in an EU/EEA or Norwegian region.`,
    );
  }

  return {
    systemId: s.id,
    sixR,
    flags,
    ...(sixR === 'retire' && time.consolidateInto ? { consolidateInto: time.consolidateInto } : {}),
    rationale,
  };
}

export function assessSixRAll(
  systems: System[],
  capabilities: CapabilityDef[],
  times: TimeResult[],
  a: Assumptions,
  g: IntegrationGraph = buildGraph(systems),
): SixRResult[] {
  const caps = new Map(capabilities.map((c) => [capabilityKey(c), c]));
  const names = new Map(systems.map((s) => [s.id, s.name]));
  const timeById = new Map(times.map((t) => [t.systemId, t]));
  return systems.map((s) =>
    assessSixR(s, timeById.get(s.id)!, caps.get(capabilityKey(s.capability)), g, a, (id) => names.get(id) ?? id),
  );
}
