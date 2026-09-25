import { buildPortfolio, type ImportReport } from '../import/build';
import { parseCsv, type CsvTable } from '../import/csv';
import type { Mapping } from '../import/schema';
import { assumptions, portfolio as demo } from '../model/data';
import type { Assumptions, Portfolio } from '../model/types';

/**
 * The demo's data-center facility cost belongs to the fictional company; an imported inventory does not state one,
 * so it is zeroed (and labelled) to keep the savings case about the imported systems only.
 */
export function assumptionsForImport(a: Assumptions): Assumptions {
  return {
    ...a,
    cost: {
      ...a.cost,
      dataCenterAnnualFixedCostNok: {
        ...a.cost.dataCenterAnnualFixedCostNok,
        value: 0,
        estimate: true,
        source: undefined,
        rationale: 'Imported inventory: no facility cost in the CSV, so none is assumed. Savings come from the listed systems only.',
      },
    },
  };
}

/** What the user confirmed; small enough to persist, and the portfolio is rebuilt from it deterministically. */
export interface ImportSource {
  fileName: string;
  text: string;
  mapping: Mapping;
}

export interface ImportedInventory {
  source: ImportSource;
  portfolio: Portfolio;
  report: ImportReport;
}

export function buildFrom(table: CsvTable, fileName: string, mapping: Mapping) {
  return buildPortfolio(table, mapping, { fileName, catalog: demo.capabilities, assumptions, baseMeta: demo.meta });
}

export function importInventory(source: ImportSource): ImportedInventory {
  const { portfolio, report } = buildFrom(parseCsv(source.text), source.fileName, source.mapping);
  return { source, portfolio, report };
}

const KEY = 'apr-import';

export function loadStoredImport(): ImportedInventory | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const src = JSON.parse(raw) as ImportSource;
    if (typeof src.text !== 'string' || typeof src.fileName !== 'string' || !src.mapping) return null;
    const inv = importInventory(src);
    return inv.portfolio.systems.length ? inv : null;
  } catch {
    return null;
  }
}

export function storeImport(src: ImportSource | null) {
  try {
    if (src) localStorage.setItem(KEY, JSON.stringify(src));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full or blocked: the import still applies for this session */
  }
}
