import type { Param } from '../../model/types';
import type { ViewProps } from '../types';

interface Row {
  path: string[];
  param: Param<unknown>;
}

const isParam = (x: unknown): x is Param<unknown> =>
  typeof x === 'object' && x !== null && 'value' in x && 'unit' in x && 'description' in x;

function flatten(node: unknown, path: string[] = []): Row[] {
  if (isParam(node)) return [{ path, param: node }];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([k, v]) => flatten(v, [...path, k]));
}

const humanize = (k: string) =>
  k
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/Nok\b/g, 'NOK')
    .replace(/Eol/g, 'EOL')
    .replace(/Fte/g, 'FTE')
    .replace(/^./, (c) => c.toUpperCase());

const SECTION: Record<string, string> = {
  referenceYear: 'General',
  time: 'TIME scoring',
  sixR: '6R decision tree',
  cost: 'Cost model',
  roadmap: 'Roadmap',
};

const compact = (x: number) => (x >= 1e6 ? `${x / 1e6}M` : x >= 1e4 ? `${x / 1e3}k` : String(x));

function formatValue(v: unknown, nested = false): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') return nested ? compact(v) : Math.abs(v) >= 10000 ? v.toLocaleString('en-US') : String(v);
  if (typeof v === 'object' && v !== null) {
    return Object.entries(v)
      .map(([k, x]) => (typeof x === 'object' && x !== null && !Array.isArray(x) ? `${k}: ${formatValue(x, true)}` : `${k} ${formatValue(x, true)}`))
      .join(typeof Object.values(v)[0] === 'object' ? '\n' : ', ');
  }
  return String(v);
}

export function AssumptionsView({ baseAssumptions, overrides }: ViewProps) {
  const rows = flatten(baseAssumptions);
  const sections = [...new Set(rows.map((r) => r.path[0]!))];
  const estimated = rows.filter((r) => r.param.estimate).length;
  const slider: Record<string, number | undefined> = {
    'cost.discountRate': overrides.discountRate,
    'cost.cloudRunCostMultiplier': overrides.cloudRunCostFactor,
    'cost.migrationCostMultiplier': overrides.migrationCostMultiplier,
  };

  return (
    <div className="view">
      <header className="view-head">
        <h2>Assumptions</h2>
        <p>
          Every parameter the engine uses, from <code>data/assumptions.json</code> (version {baseAssumptions.version}). {estimated} of{' '}
          {rows.length} are analyst estimates, each with its reasoning; sourced values name their source.
        </p>
      </header>

      <div className="callout">
        Nordlys Gruppen ASA is a fictional company. All systems, costs and factors are illustrative estimates, not benchmarks. Change a value
        in the file and every view follows; the three business-case sliders override their parameter for this session only.
      </div>

      {sections.map((sec) => (
        <section className="panel" key={sec}>
          <h3 className="panel-title">{SECTION[sec] ?? humanize(sec)}</h3>
          <div className="table-wrap">
            <table className="data-table assumptions">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                  <th>Basis</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.path[0] === sec)
                  .map((r) => {
                    const key = r.path.join('.');
                    const override = slider[key];
                    return (
                      <tr key={key}>
                        <td>
                          <div className="param-name">{r.path.slice(1).map(humanize).join(' / ') || humanize(sec)}</div>
                          <div className="muted small">{r.param.description}</div>
                        </td>
                        <td className="value-cell num">
                          <span className="pre">{formatValue(r.param.value)}</span>
                          <div className="muted small">{r.param.unit}</div>
                          {override !== undefined && override !== r.param.value && (
                            <div className="override small">Slider: {override}</div>
                          )}
                        </td>
                        <td>
                          {r.param.estimate ? (
                            <span className="tag">Estimate</span>
                          ) : (
                            <span className="tag sourced">Source: {r.param.source}</span>
                          )}
                        </td>
                        <td className="small">{r.param.rationale ?? ''}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
