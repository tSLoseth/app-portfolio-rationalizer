import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WaterfallKey } from '../../model/types';
import { quarterIndex } from '../../engine/quarters';
import { cap, mTick, nokM, pct, SIXR_ORDER } from '../format';
import type { ViewProps } from '../types';

const SHORT: Record<WaterfallKey, string> = {
  baseline: 'Baseline',
  retire: 'Retire',
  rightsizing: 'Rightsize',
  infraExit: 'Infra &|DC out',
  cloudRun: 'Cloud &|SaaS in',
  target: 'Target',
};

function TwoLineTick({ x, y, payload, fill }: { x?: number; y?: number; payload?: { value: string }; fill: string }) {
  const lines = (payload?.value ?? '').split('|');
  return (
    <text x={x} y={y} textAnchor="middle" fill={fill} fontSize={11}>
      {lines.map((l, i) => (
        <tspan key={l} x={x} dy={i === 0 ? 12 : 13}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

export function BusinessCase({ baseAssumptions, result, palette, overrides, setOverrides }: ViewProps) {
  const c = result.cost;
  const base = baseAssumptions.cost;
  const discount = overrides.discountRate ?? base.discountRate.value;
  const cloud = overrides.cloudRunCostFactor ?? base.cloudRunCostMultiplier.value;
  const migration = overrides.migrationCostMultiplier ?? base.migrationCostMultiplier.value;
  const dirty = Object.values(overrides).some((v) => v !== undefined);

  let level = 0;
  const waterfall = c.waterfall.map((s) => {
    const total = s.key === 'baseline' || s.key === 'target';
    let row;
    if (total) {
      row = { ...s, range: [0, s.value], fill: palette.total };
      level = s.value;
    } else {
      row = { ...s, range: [level, level + s.value].sort((a, b) => a - b), fill: s.value < 0 ? palette.accent : palette.add };
      level += s.value;
    }
    const m = (s.value / 1e6).toFixed(0);
    return { ...row, short: SHORT[s.key], total, lbl: total ? m : s.value > 0 ? `+${m}` : m.replace('-', '−') };
  });

  const startYear = c.cashFlows[0]?.year ?? 2027;
  let undiscounted = 0;
  const cash = [{ x: startYear, cumulative: 0, discounted: 0 }].concat(
    c.cashFlows.map((y) => {
      undiscounted += y.net;
      return { x: y.year + 1, cumulative: undiscounted, discounted: y.cumulative };
    }),
  );
  const paybackEnd = c.paybackQuarter ? (quarterIndex(c.paybackQuarter) + 1) / 4 : null;
  const paybackX = paybackEnd !== null && paybackEnd <= startYear + c.horizonYears ? paybackEnd : null;

  const sixR = SIXR_ORDER.map((r) => ({ r: cap(r), ...c.bySixR[r] }));
  const axisTick = { fill: palette.ink2, fontSize: 11 };

  return (
    <div className="view">
      <header className="view-head">
        <h2>Business case</h2>
        <p>
          Steady-state run cost before and after the programme, and the {c.horizonYears}-year cash flow using the roadmap's actual cutover
          quarters. Move the sliders to stress-test the case; every figure on every tab recomputes.
        </p>
      </header>

      <section className="panel sliders" aria-label="Scenario">
        <Slider
          label="Discount rate"
          value={discount}
          min={0}
          max={0.15}
          step={0.005}
          display={pct(discount, 1)}
          onChange={(v) => setOverrides((o) => ({ ...o, discountRate: v }))}
        />
        <Slider
          label="Cloud run-cost multiplier"
          value={cloud}
          min={0.5}
          max={2}
          step={0.05}
          display={`× ${cloud.toFixed(2)}`}
          onChange={(v) => setOverrides((o) => ({ ...o, cloudRunCostFactor: v }))}
        />
        <Slider
          label="Migration cost multiplier"
          value={migration}
          min={0.5}
          max={2}
          step={0.05}
          display={`× ${migration.toFixed(2)}`}
          onChange={(v) => setOverrides((o) => ({ ...o, migrationCostMultiplier: v }))}
        />
        <button type="button" className="btn" onClick={() => setOverrides({})} disabled={!dirty}>
          Reset to assumptions
        </button>
      </section>

      <section className="kpis" aria-label="Business case figures">
        <div className="kpi">
          <div className="kpi-label">{c.horizonYears}-year NPV</div>
          <div className="kpi-value">{nokM(c.npv)}</div>
          <div className="kpi-sub">at {pct(c.discountRate, 1)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Simple payback (steady state)</div>
          <div className="kpi-value">{c.paybackYears === null ? 'None' : `${c.paybackYears.toFixed(1)} yrs`}</div>
          <div className="kpi-sub">one-off ÷ annual run-cost saving</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Cash break-even</div>
          <div className="kpi-value">{c.paybackQuarter ?? 'Not reached'}</div>
          <div className="kpi-sub">{c.paybackQuarter ? 'cumulative cash flow turns positive' : 'cumulative cash flow stays negative'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">One-off investment</div>
          <div className="kpi-value">{nokM(c.oneOffMigration)}</div>
          <div className="kpi-sub">incl. {nokM(c.temporaryIntegrationCost)} temporary integrations</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Annual run-cost saving</div>
          <div className="kpi-value">{nokM(c.annualSaving)}</div>
          <div className="kpi-sub">{pct(c.annualSaving / c.baselineAnnual)} of {nokM(c.baselineAnnual)}</div>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h3 className="panel-title">Run-cost bridge</h3>
          <p className="panel-sub">NOK per year, steady state after the programme</p>
          <div className="legend-row">
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.total }} /> Level
            </span>
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.accent }} /> Reduces cost
            </span>
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.add }} /> Adds cost
            </span>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfall} margin={{ top: 22, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
                <CartesianGrid stroke={palette.grid} vertical={false} />
                <XAxis dataKey="short" tick={<TwoLineTick fill={palette.ink2} />} stroke={palette.axis} interval={0} tickLine={false} height={36} />
                <YAxis tickFormatter={mTick} tick={axisTick} stroke={palette.axis} width={44} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: palette.grid, opacity: 0.5 }} content={<WaterfallTip />} />
                <Bar dataKey="range" radius={4} maxBarSize={40} isAnimationActive={false}>
                  {waterfall.map((d) => (
                    <Cell key={d.key} fill={d.fill} />
                  ))}
                  <LabelList dataKey="lbl" position="top" fill={palette.ink2} fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="note">Labels in NOK millions. Deltas are signed: negative reduces run cost.</p>
        </section>

        <section className="panel">
          <h3 className="panel-title">Cumulative cash flow</h3>
          <p className="panel-sub">NOK, programme start to year {c.horizonYears}</p>
          <div className="legend-row">
            <span className="legend-item">
              <span className="line-key" style={{ background: palette.accent }} /> Undiscounted
            </span>
            <span className="legend-item">
              <span className="line-key" style={{ background: palette.total }} /> Discounted (NPV path)
            </span>
            {paybackX ? (
              <span className="legend-item">
                <span className="line-key dashed" style={{ borderColor: palette.ink2 }} /> Cash break-even {c.paybackQuarter}
              </span>
            ) : (
              <span className="legend-item muted">
                {c.paybackQuarter ? `Cash break-even ${c.paybackQuarter}, after the horizon` : 'No cash break-even'}
              </span>
            )}
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cash} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={palette.grid} vertical={false} />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[startYear, startYear + c.horizonYears]}
                  ticks={cash.map((d) => d.x)}
                  tick={axisTick}
                  stroke={palette.axis}
                  tickLine={false}
                />
                <YAxis tickFormatter={mTick} tick={axisTick} stroke={palette.axis} width={44} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke={palette.ink2} />
                {paybackX && (
                  <ReferenceLine x={paybackX} stroke={palette.ink2} strokeDasharray="4 3" />
                )}
                <Tooltip content={<CashTip />} />
                <Line
                  dataKey="cumulative"
                  name="Undiscounted"
                  stroke={palette.accent}
                  strokeWidth={2}
                  dot={{ r: 4, fill: palette.accent, stroke: palette.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="discounted"
                  name="Discounted"
                  stroke={palette.total}
                  strokeWidth={2}
                  dot={{ r: 4, fill: palette.total, stroke: palette.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="note">Points are year ends. The discounted line ends at the NPV.</p>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h3 className="panel-title">Sensitivity of NPV</h3>
          <p className="panel-sub">
            Each input moved ±{pct(baseAssumptions.cost.sensitivityRange.value)} around the current scenario; full grid spans{' '}
            {nokM(c.sensitivity.npvMin)} to {nokM(c.sensitivity.npvMax)}
          </p>
          <Tornado c={c} palette={palette} />
        </section>

        <section className="panel">
          <h3 className="panel-title">Run cost by 6R</h3>
          <p className="panel-sub">Today against target, NOK per year</p>
          <div className="legend-row">
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.total }} /> Today
            </span>
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.accent }} /> Target
            </span>
          </div>
          <div className="chart chart-short">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sixR} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
                <CartesianGrid stroke={palette.grid} horizontal={false} />
                <XAxis type="number" tickFormatter={mTick} tick={axisTick} stroke={palette.axis} tickLine={false} />
                <YAxis type="category" dataKey="r" tick={axisTick} stroke={palette.axis} width={78} tickLine={false} />
                <Tooltip cursor={{ fill: palette.grid, opacity: 0.5 }} content={<SixRTip />} />
                <Bar dataKey="baselineAnnual" name="Today" fill={palette.total} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
                <Bar dataKey="targetAnnual" name="Target" fill={palette.accent} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>6R</th>
                  <th className="r">Systems</th>
                  <th className="r">Today</th>
                  <th className="r">Target</th>
                  <th className="r">One-off</th>
                </tr>
              </thead>
              <tbody>
                {sixR.map((x) => (
                  <tr key={x.r}>
                    <td>{x.r}</td>
                    <td className="r num">{x.count}</td>
                    <td className="r num">{nokM(x.baselineAnnual)}</td>
                    <td className="r num">{nokM(x.targetAnnual)}</td>
                    <td className="r num">{nokM(x.oneOffMigration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{props.label}</span>
        <strong className="num">{props.display}</strong>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Tornado({ c, palette }: { c: ViewProps['result']['cost']; palette: ViewProps['palette'] }) {
  const rows = c.sensitivity.tornado;
  const lo = Math.min(c.npv, ...rows.flatMap((r) => [r.npvAtLow, r.npvAtHigh]));
  const hi = Math.max(c.npv, ...rows.flatMap((r) => [r.npvAtLow, r.npvAtHigh]));
  const pad = (hi - lo) * 0.05 || 1;
  const x = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  const mid = x(c.npv);
  return (
    <div className="tornado">
      {rows.map((r) => {
        const ends = [
          { v: r.npvAtLow, input: r.lowInput },
          { v: r.npvAtHigh, input: r.highInput },
        ].sort((a, b) => a.v - b.v);
        const [left, right] = ends as [(typeof ends)[0], (typeof ends)[0]];
        return (
          <div className="tornado-row" key={r.parameter}>
            <div className="tornado-label">{r.parameter}</div>
            <div className="tornado-track">
              <span
                className="tornado-seg"
                style={{ left: `${x(left.v)}%`, width: `${Math.max(0, mid - x(left.v))}%`, background: palette.add }}
                title={`× ${left.input.toFixed(2)}: NPV ${nokM(left.v)}`}
              />
              <span
                className="tornado-seg"
                style={{ left: `${mid}%`, width: `${Math.max(0, x(right.v) - mid)}%`, background: palette.accent }}
                title={`× ${right.input.toFixed(2)}: NPV ${nokM(right.v)}`}
              />
              <span className="tornado-mid" style={{ left: `${mid}%`, background: palette.ink }} />
            </div>
            <div className="tornado-ends num">
              <span>
                × {left.input.toFixed(2)}: <strong>{nokM(left.v)}</strong>
              </span>
              <span>
                × {right.input.toFixed(2)}: <strong>{nokM(right.v)}</strong>
              </span>
            </div>
          </div>
        );
      })}
      <div className="legend-row">
        <span className="legend-item">
          <span className="tornado-mid-key" style={{ background: palette.ink }} /> Current NPV {nokM(c.npv)}
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: palette.add }} /> Worse
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: palette.accent }} /> Better
        </span>
      </div>
    </div>
  );
}

interface TipProps<T> {
  active?: boolean;
  payload?: { payload: T }[];
}

function WaterfallTip({ active, payload }: TipProps<{ label: string; value: number; total: boolean }>) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  return (
    <div className="tip">
      <div className="tip-value num">{d.total ? nokM(d.value) : `${d.value > 0 ? '+' : ''}${nokM(d.value)}`}</div>
      <div className="tip-sub">{d.label}</div>
    </div>
  );
}

function CashTip({ active, payload }: TipProps<{ x: number; cumulative: number; discounted: number }>) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  return (
    <div className="tip">
      <div className="tip-title">End of {d.x - 1}</div>
      <table>
        <tbody>
          <tr>
            <td>Undiscounted</td>
            <td className="num">
              <strong>{nokM(d.cumulative)}</strong>
            </td>
          </tr>
          <tr>
            <td>Discounted</td>
            <td className="num">
              <strong>{nokM(d.discounted)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SixRTip({ active, payload }: TipProps<{ r: string; count: number; baselineAnnual: number; targetAnnual: number; oneOffMigration: number }>) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  return (
    <div className="tip">
      <div className="tip-title">
        {d.r} ({d.count} systems)
      </div>
      <table>
        <tbody>
          <tr>
            <td>Today</td>
            <td className="num">
              <strong>{nokM(d.baselineAnnual)}</strong>
            </td>
          </tr>
          <tr>
            <td>Target</td>
            <td className="num">
              <strong>{nokM(d.targetAnnual)}</strong>
            </td>
          </tr>
          <tr>
            <td>One-off</td>
            <td className="num">
              <strong>{nokM(d.oneOffMigration)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
