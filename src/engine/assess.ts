import type {
  Assumptions,
  Portfolio,
  PortfolioCostSummary,
  RoadmapResult,
  SystemAssessment,
} from '../model/types';
import { assessCosts, summarizePortfolioCost } from './cost';
import { buildGraph } from './graph';
import { planRoadmap, roadmapTiming } from './roadmap';
import { assessSixRAll } from './sixR';
import { assessTimeAll } from './time';

export { withOverrides, type AssumptionOverrides } from './overrides';

export interface PortfolioAssessment {
  assessments: SystemAssessment[];
  cost: PortfolioCostSummary;
  roadmap: RoadmapResult;
}

/**
 * Single entry point for the UI: TIME → 6R → cost → roadmap → timed business case.
 * Pure: recompute with withOverrides(assumptions, sliders) whenever a slider moves.
 */
export function assessPortfolio(portfolio: Portfolio, assumptions: Assumptions): PortfolioAssessment {
  const { systems } = portfolio;
  const g = buildGraph(systems);
  const times = assessTimeAll(systems, assumptions);
  const sixRs = assessSixRAll(systems, portfolio.capabilities, times, assumptions, g);
  const costs = assessCosts(systems, sixRs, assumptions, g);
  const roadmap = planRoadmap(systems, sixRs, costs, assumptions, g);
  const cost = summarizePortfolioCost(systems, sixRs, assumptions, roadmapTiming(roadmap, assumptions), g);
  const items = new Map(roadmap.items.map((i) => [i.systemId, i]));
  const assessments = systems.map((system, i) => {
    const item = items.get(system.id);
    return { system, time: times[i]!, sixR: sixRs[i]!, cost: costs[i]!, ...(item ? { roadmap: item } : {}) };
  });
  return { assessments, cost, roadmap };
}
