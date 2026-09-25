// Shared data contract for generator, engine and UI.
// All fit sub-scores are integers 1–5 where 5 is best (for eolRisk: 5 = lowest risk).
// All money is NOK per year unless the field name says otherwise.

export type CapabilityL1 =
  | 'Finance'
  | 'HR'
  | 'Sales & CRM'
  | 'Supply Chain'
  | 'Production/OT'
  | 'Data & Analytics'
  | 'Collaboration'
  | 'IT/Security';

export interface Capability {
  l1: CapabilityL1;
  l2: string;
}

export interface CapabilityDef extends Capability {
  id: string;
  /** A credible COTS/SaaS replacement exists for this L2 — makes 6R "repurchase" decidable. */
  saasAlternative: boolean;
  saasAlternativeExample?: string;
}

export type Origin = 'core' | 'acquired_A' | 'acquired_B' | 'shadow_it';
export type SystemType = 'custom' | 'cots' | 'saas';
export type Hosting = 'on_prem_dc' | 'private_cloud' | 'saas' | 'public_cloud';
export type DataSensitivity = 'public' | 'internal' | 'personal' | 'special_category';
export type SizeClass = 'S' | 'M' | 'L' | 'XL';

export interface BusinessFit {
  functionalCoverage: number;
  userSatisfaction: number;
  strategicRelevance: number;
}

export interface TechnicalFit {
  supportability: number;
  security: number;
  scalability: number;
  documentation: number;
  eolRisk: number;
}

export interface AnnualCost {
  license: number;
  infra: number;
  /** Internal staff cost in NOK (FTE × loaded cost), not an FTE count. */
  supportFte: number;
  vendorSupport: number;
}

export interface System {
  id: string;
  name: string;
  vendor: string;
  description: string;
  capability: Capability;
  origin: Origin;
  type: SystemType;
  hosting: Hosting;
  /** First element is the primary platform. */
  techStack: string[];
  /** null = vendor-managed (SaaS/PaaS), no platform EOL owned by the client. */
  platformEolYear: number | null;
  lastMajorUpgrade: number;
  users: number;
  businessCriticality: number;
  dataSensitivity: DataSensitivity;
  /** Data must stay in EU/EEA (or Norway) — e.g. health or payroll data. */
  residencyRequired: boolean;
  /** Runs at a plant (OT/edge) rather than in the central data center; outside DC-exit scope. */
  siteBound: boolean;
  businessFit: BusinessFit;
  technicalFit: TechnicalFit;
  annualCost: AnnualCost;
  /** Ids of systems this system depends on (consumes data from / calls). */
  integrations: string[];
  sizeClass: SizeClass;
  /** Systems sharing a duplicateGroup overlap functionally within the same L2 capability. */
  duplicateGroup?: string;
  /** Exactly one system per duplicateGroup is primary (the group standard to consolidate onto). */
  isPrimary?: boolean;
  /** CSV import audit trail: values that were assumed, derived or could not be read. */
  importNotes?: string[];
}

export interface PortfolioMeta {
  company: string;
  description: string;
  employees: number;
  referenceYear: number;
  dataCenterLeaseExpiry: number;
  acquisitions: { origin: 'acquired_A' | 'acquired_B'; name: string; year: number; employees: number }[];
  seed: number;
  generator: string;
  originLabels?: Partial<Record<Origin, string>>;
  imported?: { fileName: string; rows: number };
}

export interface Portfolio {
  meta: PortfolioMeta;
  capabilities: CapabilityDef[];
  systems: System[];
}

// ---- Assumptions (data/assumptions.json) ----

interface ParamBase<T> {
  value: T;
  unit: string;
  description: string;
}
export type SourcedParam<T> = ParamBase<T> & { source: string; estimate?: false; rationale?: string };
export type EstimatedParam<T> = ParamBase<T> & { estimate: true; rationale: string; source?: undefined };
export type Param<T> = SourcedParam<T> | EstimatedParam<T>;

export type TimeCategory = 'tolerate' | 'invest' | 'migrate' | 'eliminate';
export type SixR = 'rehost' | 'replatform' | 'repurchase' | 'refactor' | 'retire' | 'retain';
export type Quarter = `${number}Q${1 | 2 | 3 | 4}`;

export type PerSixR<T> = Record<SixR, T>;
export type PerSize<T> = Record<SizeClass, T>;

export interface Assumptions {
  version: string;
  currency: 'NOK';
  referenceYear: Param<number>;
  time: {
    businessValueWeights: {
      functionalCoverage: Param<number>;
      userSatisfaction: Param<number>;
      strategicRelevance: Param<number>;
      businessCriticality: Param<number>;
    };
    technicalHealthWeights: {
      supportability: Param<number>;
      security: Param<number>;
      scalability: Param<number>;
      documentation: Param<number>;
      eolRisk: Param<number>;
    };
    eolPenalty: {
      alreadyExpired: Param<number>;
      expiresWithinWindow: Param<number>;
      windowYears: Param<number>;
    };
    valueThreshold: Param<number>;
    healthThreshold: Param<number>;
    overrides: {
      nonPrimaryDuplicate: Param<TimeCategory>;
      eolMigrateMaxYearsToEol: Param<number>;
      eolMigrateMinCriticality: Param<number>;
    };
  };
  sixR: {
    lowComplexityMaxIntegrations: Param<number>;
    lowComplexitySizeClasses: Param<SizeClass[]>;
    refactorMinBusinessValue: Param<number>;
    investRefactorSizeClasses: Param<SizeClass[]>;
    residencyFlagSensitivity: Param<DataSensitivity>;
  };
  cost: {
    fteLoadedCostNok: Param<number>;
    infraFactor: Param<PerSixR<number>>;
    supportFteFactor: Param<PerSixR<number>>;
    licenseFactor: Param<PerSixR<number>>;
    repurchaseSubscriptionFactor: Param<number>;
    repurchaseMinSubscriptionNok: Param<number>;
    cloudRunCostMultiplier: Param<number>;
    consolidationRunCostFactor: Param<number>;
    migrationCostNok: Param<PerSixR<PerSize<number>>>;
    migrationCostMultiplier: Param<number>;
    consolidationCostNok: Param<PerSize<number>>;
    dayRateNok: Param<number>;
    integrationComplexityPerIntegration: Param<number>;
    integrationComplexityMaxMultiplier: Param<number>;
    erpProgrammeCapabilityL2: Param<string>;
    erpProgrammeSizeClasses: Param<SizeClass[]>;
    erpProgrammeOneOffNok: Param<number>;
    dataCenterAnnualFixedCostNok: Param<number>;
    discountRate: Param<number>;
    horizonYears: Param<number>;
    sensitivityRange: Param<number>;
  };
  roadmap: {
    startQuarter: Param<Quarter>;
    endQuarter: Param<Quarter>;
    maxSystemsPerQuarter: Param<number>;
    maxPersonDaysPerQuarter: Param<number>;
    dcExitMilestone: Param<Quarter>;
    waves: Param<Record<'0' | '1' | '2' | '3', SixR[]>>;
    rehostWaveMaxIntegrations: Param<number>;
    temporaryIntegrationPersonDays: Param<number>;
    retireQuickWinMaxDependants: Param<number>;
    maxPersonDaysPerSystemPerQuarter: Param<number>;
    maxLightRetirementsPerQuarter: Param<number>;
    erpProgrammeDurationQuarters: Param<number>;
    erpProgrammeSharedCapacityShare: Param<number>;
  };
}

// ---- Engine outputs (produced by src/engine in later steps) ----

export type TimeOverride = 'non_primary_duplicate' | 'eol_critical';
/**
 * shadow_it_governance: built/bought outside IT — needs an owner and a governance decision.
 * critical_consolidation: business-critical duplicate with imminent EOL; the EOL override was
 * superseded by consolidation, so the retirement is a real migration project, not a switch-off.
 */
export type TimeFlag = 'shadow_it_governance' | 'critical_consolidation';

export interface TimeResult {
  systemId: string;
  businessValue: number;
  technicalHealth: number;
  eolPenalty: number;
  /** Years from reference year to platform EOL; null when vendor-managed. Negative = expired. */
  yearsToEol: number | null;
  /** Quadrant from scores alone, before overrides. */
  quadrant: TimeCategory;
  /** Final category after overrides. */
  category: TimeCategory;
  overridesApplied: TimeOverride[];
  flags: TimeFlag[];
  /** Id of the duplicate-group primary this system should be consolidated into. */
  consolidateInto?: string;
  rationale: string[];
}

/**
 * requires_eu_no_region: residency-bound data moving to cloud/SaaS.
 * site_bound: plant/OT system kept at site, outside DC-exit scope.
 * dc_exit_forced: the tree would retain it, but it sits in the closing data center.
 * consolidation: retirement that migrates data/users into the duplicate-group primary.
 */
export type SixRFlag = 'requires_eu_no_region' | 'site_bound' | 'dc_exit_forced' | 'consolidation';

export interface SixRResult {
  systemId: string;
  sixR: SixR;
  flags: SixRFlag[];
  consolidateInto?: string;
  rationale: string[];
}

/** Target run cost split so the portfolio waterfall can be built from system results. */
export interface TargetCostBreakdown {
  licenseAndVendor: number;
  internalSupport: number;
  /** Infra that stays where it is (retained systems). */
  keptInfra: number;
  /** New cloud infra (rehost/replatform/refactor) or SaaS subscription (repurchase). */
  cloudRun: number;
  /** Extra licences/capacity on the primary when a duplicate is consolidated into it. */
  consolidationUplift: number;
}

export interface CostResult {
  systemId: string;
  sixR: SixR;
  baselineAnnual: number;
  target: TargetCostBreakdown;
  targetAnnual: number;
  annualSaving: number;
  integrationMultiplier: number;
  /** One-off cost of the 6R move itself (rate × size × integration multiplier × price multiplier). */
  migrationCost: number;
  /** Data/user/interface migration into the primary for consolidation retirements. */
  consolidationCost: number;
  oneOffMigration: number;
  /** Effort at base prices; the migration-cost slider changes price, not effort. */
  migrationPersonDays: number;
  /** ERP-class transformation costed as a whole programme instead of rate × size × integrations. */
  erpProgramme?: boolean;
  /** Years; null when the change never pays back. */
  paybackYears: number | null;
  /** Standalone NPV over the horizon as if cut over in the first programme quarter. */
  npv: number;
  rationale: string[];
}

export type WaterfallKey = 'baseline' | 'retire' | 'rightsizing' | 'infraExit' | 'cloudRun' | 'target';

export interface WaterfallStep {
  key: WaterfallKey;
  label: string;
  /** Absolute level for baseline/target, signed delta for the steps in between. */
  value: number;
}

export interface YearCashFlow {
  year: number;
  investment: number;
  saving: number;
  net: number;
  discounted: number;
  cumulative: number;
}

export interface SensitivityResult {
  grid: { cloudRunCostFactor: number; migrationCostMultiplier: number; npv: number }[];
  tornado: { parameter: string; lowInput: number; highInput: number; npvAtLow: number; npvAtHigh: number }[];
  npvMin: number;
  npvMax: number;
}

export interface PortfolioCostSummary {
  /** Systems + data-center facility. */
  baselineAnnual: number;
  systemsBaselineAnnual: number;
  dataCenterFacilityAnnual: number;
  /** Steady state after the programme (facility removed only if the DC is exited). */
  targetAnnual: number;
  annualSaving: number;
  /** Systems' one-off cost plus temporary integrations. */
  oneOffMigration: number;
  temporaryIntegrationCost: number;
  paybackYears: number | null;
  /** First quarter where cumulative undiscounted cash flow turns non-negative. */
  paybackQuarter: Quarter | null;
  npv: number;
  discountRate: number;
  horizonYears: number;
  cashFlows: YearCashFlow[];
  waterfall: WaterfallStep[];
  bySixR: Record<SixR, { count: number; baselineAnnual: number; targetAnnual: number; oneOffMigration: number }>;
  sensitivity: SensitivityResult;
}

export type Wave = 0 | 1 | 2 | 3;

export interface RoadmapItem {
  systemId: string;
  wave: Wave;
  sixR: SixR;
  /** First quarter of migration work. */
  startQuarter: Quarter;
  /** Cutover (go-live / switch-off) quarter. */
  quarter: Quarter;
  durationQuarters: number;
  /** Migration effort plus temporary-integration effort. */
  personDays: number;
  migrationPersonDays: number;
  bridgePersonDays: number;
  /** Dependencies not yet cut over when this system moves; bridged with a temporary integration. */
  temporaryIntegrations: string[];
  consolidateInto?: string;
  /** Hosted in the closing data center (and not site-bound). */
  dcScope: boolean;
  /** Switch-off of a non-DC system without dependants or consolidation: uses light-retirement capacity. */
  lightRetirement: boolean;
  /** Dedicated ERP programme: own team, fixed duration, only a share of its effort hits the shared pool. */
  erpProgramme: boolean;
  rationale: string[];
}

export interface BrokenCycle {
  /** A dependency cycle through the cut edge, first id repeated at the end. */
  cycle: string[];
  cutEdge: { from: string; to: string };
  rule: string;
  /** True when the plan actually needs a bridge for the cut edge (both ends move, dependant first). */
  temporaryIntegration: boolean;
  personDays: number;
}

export type DcExitViolationReason = 'retained_in_dc' | 'unscheduled' | 'late';

export interface RoadmapResult {
  items: RoadmapItem[];
  /**
   * cutovers counts every system cut over; lightRetirements is the subset that uses the separate
   * light-retirement capacity instead of the cutover cap. personDays is shared-pool effort only.
   */
  quarters: { quarter: Quarter; cutovers: number; lightRetirements: number; personDays: number; byWave: Record<Wave, number> }[];
  cyclesBroken: BrokenCycle[];
  dcExit: {
    milestone: Quarter;
    achieved: boolean;
    /** Quarter in which the last in-scope system leaves; null if some never leave. */
    exitQuarter: Quarter | null;
    inScope: number;
    violations: { systemId: string; reason: DcExitViolationReason; quarter?: Quarter }[];
  };
  /** Retain decisions: not scheduled. */
  retained: string[];
  /** Did not fit before the end quarter. */
  unscheduled: string[];
  capacity: {
    maxCutoversPerQuarter: number;
    maxLightRetirementsPerQuarter: number;
    maxPersonDaysPerQuarter: number;
    maxPersonDaysPerSystemPerQuarter: number;
  };
}

export interface SystemAssessment {
  system: System;
  time: TimeResult;
  sixR: SixRResult;
  cost: CostResult;
  roadmap?: RoadmapItem;
}

export function capabilityKey(c: Capability): string {
  return `${c.l1} / ${c.l2}`;
}
