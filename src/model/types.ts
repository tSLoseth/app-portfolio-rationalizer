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
    migrationCostNok: Param<PerSixR<PerSize<number>>>;
    dayRateNok: Param<number>;
    integrationComplexityPerIntegration: Param<number>;
    integrationComplexityMaxMultiplier: Param<number>;
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
  };
}

// ---- Engine outputs (produced by src/engine in later steps) ----

export interface TimeResult {
  systemId: string;
  businessValue: number;
  technicalHealth: number;
  /** Quadrant from scores alone, before overrides. */
  quadrant: TimeCategory;
  /** Final category after overrides. */
  category: TimeCategory;
  overridesApplied: ('non_primary_duplicate' | 'eol_critical')[];
  rationale: string[];
}

export type SixRFlag = 'requires_eu_no_region';

export interface SixRResult {
  systemId: string;
  sixR: SixR;
  flags: SixRFlag[];
  rationale: string[];
}

export interface CostResult {
  systemId: string;
  baselineAnnual: number;
  targetAnnual: number;
  annualSaving: number;
  oneOffMigration: number;
  migrationPersonDays: number;
  /** Years; null when the change never pays back. */
  paybackYears: number | null;
  npv: number;
}

export interface PortfolioCostSummary {
  baselineAnnual: number;
  targetAnnual: number;
  annualSaving: number;
  oneOffMigration: number;
  paybackYears: number | null;
  npv: number;
  sensitivity: { label: string; npv: number }[];
}

export type Wave = 0 | 1 | 2 | 3;

export interface RoadmapItem {
  systemId: string;
  wave: Wave;
  quarter: Quarter;
  sixR: SixR;
  personDays: number;
  /** Dependencies not yet handled when moved; bridged with a temporary integration. */
  temporaryIntegrations: string[];
}

export interface RoadmapResult {
  items: RoadmapItem[];
  quarters: { quarter: Quarter; systems: number; personDays: number }[];
  cyclesBroken: string[][];
  dcExit: { milestone: Quarter; ok: boolean; lateSystems: string[] };
  unscheduled: string[];
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
