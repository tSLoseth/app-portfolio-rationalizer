import type { Assumptions, System, TimeCategory, TimeFlag, TimeOverride, TimeResult } from '../model/types';

export const fmt = (x: number, digits = 2) => x.toFixed(digits);
/** Weighted sums of exact scores can land at 2.9999999…; thresholds are inclusive. */
export const atLeast = (x: number, threshold: number) => x >= threshold - 1e-9;
const eolWhen = (years: number) => (years < 0 ? `expired ${-years} year(s) ago` : `${years} year(s) away`);

export function businessValue(s: System, a: Assumptions): number {
  const w = a.time.businessValueWeights;
  return (
    w.functionalCoverage.value * s.businessFit.functionalCoverage +
    w.userSatisfaction.value * s.businessFit.userSatisfaction +
    w.strategicRelevance.value * s.businessFit.strategicRelevance +
    w.businessCriticality.value * s.businessCriticality
  );
}

export function yearsToEol(s: System, a: Assumptions): number | null {
  return s.platformEolYear === null ? null : s.platformEolYear - a.referenceYear.value;
}

export function eolPenalty(s: System, a: Assumptions): number {
  const years = yearsToEol(s, a);
  const p = a.time.eolPenalty;
  if (years === null) return 0;
  if (years < 0) return p.alreadyExpired.value;
  if (years < p.windowYears.value) return p.expiresWithinWindow.value;
  return 0;
}

export function technicalHealth(s: System, a: Assumptions): number {
  const w = a.time.technicalHealthWeights;
  const t = s.technicalFit;
  const weighted =
    w.supportability.value * t.supportability +
    w.security.value * t.security +
    w.scalability.value * t.scalability +
    w.documentation.value * t.documentation +
    w.eolRisk.value * t.eolRisk;
  return weighted - eolPenalty(s, a);
}

export function quadrantOf(value: number, health: number, a: Assumptions): TimeCategory {
  const highValue = atLeast(value, a.time.valueThreshold.value);
  const highHealth = atLeast(health, a.time.healthThreshold.value);
  if (highValue) return highHealth ? 'invest' : 'migrate';
  return highHealth ? 'tolerate' : 'eliminate';
}

/** Primary system per duplicate group; the context TIME needs beyond the system itself. */
export function primariesByGroup(systems: System[]): Map<string, System> {
  const m = new Map<string, System>();
  for (const s of systems) if (s.duplicateGroup && s.isPrimary) m.set(s.duplicateGroup, s);
  return m;
}

export function assessTime(s: System, a: Assumptions, primaries: Map<string, System>): TimeResult {
  const value = businessValue(s, a);
  const penalty = eolPenalty(s, a);
  const health = technicalHealth(s, a);
  const years = yearsToEol(s, a);
  const vt = a.time.valueThreshold.value;
  const ht = a.time.healthThreshold.value;
  const quadrant = quadrantOf(value, health, a);
  const rationale: string[] = [];
  const overridesApplied: TimeOverride[] = [];
  const flags: TimeFlag[] = [];

  rationale.push(
    `Business value ${fmt(value)} (coverage ${s.businessFit.functionalCoverage}, satisfaction ${s.businessFit.userSatisfaction}, ` +
      `strategic ${s.businessFit.strategicRelevance}, criticality ${s.businessCriticality}) is ${atLeast(value, vt) ? 'high' : 'low'} vs threshold ${fmt(vt, 1)}.`,
  );
  const eolText =
    years === null
      ? 'vendor-managed platform, no EOL penalty'
      : penalty > 0
        ? `EOL penalty −${fmt(penalty)} (platform EOL ${s.platformEolYear}, ${years < 0 ? 'already expired' : `${years} year(s) left`})`
        : `platform EOL ${s.platformEolYear}, no penalty`;
  rationale.push(
    `Technical health ${fmt(health)} (supportability ${s.technicalFit.supportability}, security ${s.technicalFit.security}, ` +
      `scalability ${s.technicalFit.scalability}, documentation ${s.technicalFit.documentation}, EOL-risk ${s.technicalFit.eolRisk}; ${eolText}) ` +
      `is ${atLeast(health, ht) ? 'high' : 'low'} vs threshold ${fmt(ht, 1)}.`,
  );
  rationale.push(`Score-based quadrant: ${quadrant}.`);

  let category = quadrant;
  const eolCritical =
    years !== null &&
    years < a.time.overrides.eolMigrateMaxYearsToEol.value &&
    s.businessCriticality >= a.time.overrides.eolMigrateMinCriticality.value;
  const primary = s.duplicateGroup && !s.isPrimary ? primaries.get(s.duplicateGroup) : undefined;

  if (primary) {
    category = a.time.overrides.nonPrimaryDuplicate.value;
    overridesApplied.push('non_primary_duplicate');
    rationale.push(
      `Override: non-primary member of duplicate group ${s.duplicateGroup} (${s.capability.l2}) → ${category}; consolidate into ${primary.name} (${primary.id}).`,
    );
    if (eolCritical) {
      flags.push('critical_consolidation');
      rationale.push(
        `EOL override (criticality ${s.businessCriticality} ≥ ${a.time.overrides.eolMigrateMinCriticality.value}, EOL ${eolWhen(years!)}, threshold < ${a.time.overrides.eolMigrateMaxYearsToEol.value} years) ` +
          `is superseded by consolidation: migrating a platform that is being consolidated away wastes money. Retirement is a critical ` +
          `consolidation project and must follow ${primary.name} being in place.`,
      );
    }
  } else if (eolCritical && (category === 'tolerate' || category === 'eliminate')) {
    category = 'migrate';
    overridesApplied.push('eol_critical');
    rationale.push(
      `Override: platform EOL ${s.platformEolYear} ${eolWhen(years!)} (< ${a.time.overrides.eolMigrateMaxYearsToEol.value} years) and criticality ` +
        `${s.businessCriticality} ≥ ${a.time.overrides.eolMigrateMinCriticality.value} → at least migrate.`,
    );
  }

  if (s.origin === 'shadow_it') {
    flags.push('shadow_it_governance');
    rationale.push('Governance flag: shadow IT — assign a business owner and bring under IT governance; category follows the scores, not the origin.');
  }

  return {
    systemId: s.id,
    businessValue: value,
    technicalHealth: health,
    eolPenalty: penalty,
    yearsToEol: years,
    quadrant,
    category,
    overridesApplied,
    flags,
    ...(primary ? { consolidateInto: primary.id } : {}),
    rationale,
  };
}

export function assessTimeAll(systems: System[], a: Assumptions): TimeResult[] {
  const primaries = primariesByGroup(systems);
  return systems.map((s) => assessTime(s, a, primaries));
}
