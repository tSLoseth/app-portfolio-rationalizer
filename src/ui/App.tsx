import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { assessPortfolio, withOverrides, type AssumptionOverrides } from '../engine/assess';
import { assumptions as demoAssumptions, portfolio as demoPortfolio } from '../model/data';
import { assumptionsForImport, importInventory, loadStoredImport, storeImport, type ImportedInventory, type ImportSource } from './importState';
import { AssumptionsView } from './views/AssumptionsView';
import { CapabilityMap } from './views/CapabilityMap';
import { ImportView } from './views/ImportView';
import { Overview } from './views/Overview';
import { SystemDetail } from './views/SystemDetail';
import type { ViewProps } from './types';
import { useTheme } from './theme';

// Recharts views load on demand so the overview paints without the charting bundle.
const TimeMatrix = lazy(() => import('./views/TimeMatrix').then((m) => ({ default: m.TimeMatrix })));
const BusinessCase = lazy(() => import('./views/BusinessCase').then((m) => ({ default: m.BusinessCase })));
const RoadmapView = lazy(() => import('./views/RoadmapView').then((m) => ({ default: m.RoadmapView })));

const VIEWS = [
  { id: 'overview', label: 'Overview', Component: Overview },
  { id: 'time', label: 'TIME matrix', Component: TimeMatrix },
  { id: 'capabilities', label: 'Capability map', Component: CapabilityMap },
  { id: 'business-case', label: 'Business case', Component: BusinessCase },
  { id: 'roadmap', label: 'Roadmap & systems', Component: RoadmapView },
  { id: 'assumptions', label: 'Assumptions', Component: AssumptionsView },
  { id: 'import', label: 'Import CSV', Component: ImportView },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

const viewFromHash = (): ViewId => {
  const h = location.hash.replace('#', '');
  return (VIEWS.find((v) => v.id === h)?.id ?? 'overview') as ViewId;
};

export function App() {
  const { theme, palette, toggle } = useTheme();
  const [view, setView] = useState<ViewId>(viewFromHash);
  const [overrides, setOverrides] = useState<AssumptionOverrides>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedInventory | null>(loadStoredImport);
  const portfolio = imported?.portfolio ?? demoPortfolio;

  useEffect(() => {
    const on = () => setView(viewFromHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    document.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [view]);

  const baseAssumptions = useMemo(() => (imported ? assumptionsForImport(demoAssumptions) : demoAssumptions), [imported]);
  const assumptions = useMemo(() => withOverrides(baseAssumptions, overrides), [baseAssumptions, overrides]);
  const result = useMemo(() => assessPortfolio(portfolio, assumptions), [portfolio, assumptions]);

  const openSystem = useCallback((id: string) => setSelected(id), []);
  const go = (id: ViewId) => {
    history.replaceState(null, '', `#${id}`);
    setView(id);
    scrollTo({ top: 0 });
  };

  const onImport = (source: ImportSource) => {
    setImported(importInventory(source));
    storeImport(source);
    setSelected(null);
    go('overview');
  };
  const onResetImport = () => {
    setImported(null);
    storeImport(null);
    setSelected(null);
  };

  const props: ViewProps = {
    portfolio,
    baseAssumptions,
    assumptions,
    result,
    palette,
    overrides,
    setOverrides,
    openSystem,
    imported,
    onImport,
    onResetImport,
  };
  const Active = VIEWS.find((v) => v.id === view)!.Component;
  const selectedAssessment = selected ? result.assessments.find((a) => a.system.id === selected) : undefined;

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <h1>Application Portfolio Rationalizer</h1>
            {imported ? (
              <p className="driver">
                <span className="badge">Imported inventory</span>
                {imported.source.fileName}: {portfolio.systems.length} systems, assessed with the same rules and assumptions as the demo.
              </p>
            ) : (
              <p className="driver">
                <span className="badge">Nordlys Gruppen ASA (fictional)</span>
                Post-merger: two acquisitions left duplicate CRM, BI and ERP stacks. The data-center lease expires in{' '}
                {portfolio.meta.dataCenterLeaseExpiry}.
              </p>
            )}
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
        </div>
      </header>
      <nav className="tabs" aria-label="Views">
        <div className="tabs-inner" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? 'tab active' : 'tab'}
              onClick={() => go(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </nav>

      {imported && (
        <div className="import-banner" role="status">
          <div className="import-banner-inner">
            <span>
              Viewing imported inventory: <strong>{imported.source.fileName}</strong> ({portfolio.systems.length} systems)
            </span>
            <button type="button" className="btn btn-small" onClick={onResetImport}>
              Reset to demo
            </button>
          </div>
        </div>
      )}

      <main className="content">
        <Suspense fallback={<p className="muted">Loading view…</p>}>
          <Active key={imported ? `import:${imported.source.fileName}:${portfolio.systems.length}` : 'demo'} {...props} />
        </Suspense>
      </main>

      <footer className="footer">
        {imported
          ? 'Imported data stays in this browser. Rules-based engine; values assumed during import are listed in each system’s rule trace.'
          : 'Fictional data. Rules-based engine; every recommendation traceable to attributes and thresholds.'}
      </footer>

      {selectedAssessment && (
        <SystemDetail
          key={selectedAssessment.system.id}
          assessment={selectedAssessment}
          all={result.assessments}
          originLabels={portfolio.meta.originLabels}
          onClose={() => setSelected(null)}
          onOpen={openSystem}
        />
      )}
    </div>
  );
}
