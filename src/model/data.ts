import portfolioJson from '../../data/portfolio.json';
import assumptionsJson from '../../data/assumptions.json';
import type { Assumptions, Portfolio } from './types';

// JSON imports widen string literals to string; the invariant tests guarantee the shape.
export const portfolio = portfolioJson as unknown as Portfolio;
export const assumptions = assumptionsJson as unknown as Assumptions;
