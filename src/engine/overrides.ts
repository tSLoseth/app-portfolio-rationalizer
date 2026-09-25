import type { Assumptions, Param } from '../model/types';

/** The dashboard sliders. Values are absolute (e.g. discountRate 0.1), not deltas. */
export interface AssumptionOverrides {
  discountRate?: number;
  cloudRunCostFactor?: number;
  migrationCostMultiplier?: number;
}

const set = <T>(p: Param<T>, value: T | undefined): Param<T> => (value === undefined ? p : { ...p, value });

/** Returns a new Assumptions object; the input is never mutated. */
export function withOverrides(a: Assumptions, o: AssumptionOverrides): Assumptions {
  return {
    ...a,
    cost: {
      ...a.cost,
      discountRate: set(a.cost.discountRate, o.discountRate),
      cloudRunCostMultiplier: set(a.cost.cloudRunCostMultiplier, o.cloudRunCostFactor),
      migrationCostMultiplier: set(a.cost.migrationCostMultiplier, o.migrationCostMultiplier),
    },
  };
}
