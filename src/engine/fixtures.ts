// Test helpers: small synthetic systems with every score at 3 unless overridden.
import type { CapabilityDef, System } from '../model/types';

type SystemInit = Partial<Omit<System, 'businessFit' | 'technicalFit' | 'annualCost'>> & {
  businessFit?: Partial<System['businessFit']>;
  technicalFit?: Partial<System['technicalFit']>;
  annualCost?: Partial<System['annualCost']>;
};

export function makeSystem(init: SystemInit = {}): System {
  const { businessFit, technicalFit, annualCost, ...rest } = init;
  return {
    id: 'X',
    name: 'Test system',
    vendor: 'Test',
    description: '',
    capability: { l1: 'Finance', l2: 'Test L2' },
    origin: 'core',
    type: 'cots',
    hosting: 'on_prem_dc',
    techStack: ['Test'],
    platformEolYear: null,
    lastMajorUpgrade: 2020,
    users: 100,
    businessCriticality: 3,
    dataSensitivity: 'internal',
    residencyRequired: false,
    siteBound: false,
    integrations: [],
    sizeClass: 'M',
    ...rest,
    businessFit: { functionalCoverage: 3, userSatisfaction: 3, strategicRelevance: 3, ...businessFit },
    technicalFit: { supportability: 3, security: 3, scalability: 3, documentation: 3, eolRisk: 3, ...technicalFit },
    annualCost: { license: 0, infra: 0, supportFte: 0, vendorSupport: 0, ...annualCost },
  };
}

export const allScores = (n: number) => ({
  businessFit: { functionalCoverage: n, userSatisfaction: n, strategicRelevance: n },
  businessCriticality: n,
});
export const allHealth = (n: number) => ({
  technicalFit: { supportability: n, security: n, scalability: n, documentation: n, eolRisk: n },
});

export function makeCapability(l2 = 'Test L2', saasAlternative = false): CapabilityDef {
  return { id: l2, l1: 'Finance', l2, saasAlternative };
}
