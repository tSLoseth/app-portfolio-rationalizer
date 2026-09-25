import type { Dispatch, SetStateAction } from 'react';
import type { AssumptionOverrides, PortfolioAssessment } from '../engine/assess';
import type { Assumptions, Portfolio } from '../model/types';
import type { ImportedInventory, ImportSource } from './importState';
import type { ChartPalette } from './theme';

export interface ViewProps {
  portfolio: Portfolio;
  baseAssumptions: Assumptions;
  assumptions: Assumptions;
  result: PortfolioAssessment;
  palette: ChartPalette;
  overrides: AssumptionOverrides;
  setOverrides: Dispatch<SetStateAction<AssumptionOverrides>>;
  openSystem: (id: string) => void;
  imported: ImportedInventory | null;
  onImport: (source: ImportSource) => void;
  onResetImport: () => void;
}
