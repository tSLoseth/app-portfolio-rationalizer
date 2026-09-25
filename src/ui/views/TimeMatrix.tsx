import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { CapabilityL1, Hosting, Origin, TimeCategory } from '../../model/types';
import { cap, HOSTING_LABEL, nokM, ORIGIN_LABEL, TIME_ORDER } from '../format';
import type { ViewProps } from '../types';

interface Point {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  time: TimeCategory;
  quadrant: TimeCategory;
  l1: CapabilityL1;
  l2: string;
  sixR: string;
}

type ColourBy = 'time' | 'capability';
// Health can drop below 1 after the EOL penalty.
const X_MIN = 0.5;

export function TimeMatrix({ portfolio, assumptions, result, palette, openSystem }: ViewProps) {
  const [l1, setL1] = useState<CapabilityL1 | ''>('');
  const [origin, setOrigin] = useState<Origin | ''>('');
  const [hosting, setHosting] = useState<Hosting | ''>('');
  const [colourBy, setColourBy] = useState<ColourBy>('time');
  const l1s = useMemo(() => [...new Set(portfolio.capabilities.map((c) => c.l1))], [portfolio]);
  const [highlight, setHighlight] = useState<CapabilityL1>(l1s[0]!);

  const vt = assumptions.time.valueThreshold.value;
  const ht = assumptions.time.healthThreshold.value;

  const points: Point[] = result.assessments
    .filter((a) => (!l1 || a.system.capability.l1 === l1) && (!origin || a.system.origin === origin) && (!hosting || a.system.hosting === hosting))
    .map((a) => ({
      id: a.system.id,
      name: a.system.name,
      x: a.time.technicalHealth,
      y: a.time.businessValue,
      z: a.cost.baselineAnnual,
      time: a.time.category,
      quadrant: a.time.quadrant,
      l1: a.system.capability.l1,
      l2: a.system.capability.l2,
      sixR: a.sixR.sixR,
    }));

  const series =
    colourBy === 'time'
      ? TIME_ORDER.map((t) => ({ key: t, label: cap(t), colour: palette.time[t], data: points.filter((p) => p.time === t) }))
      : [
          { key: 'other', label: 'Other capabilities', colour: palette.muted, data: points.filter((p) => p.l1 !== highlight) },
          { key: 'hl', label: highlight, colour: palette.accent, data: points.filter((p) => p.l1 === highlight) },
        ];

  const onPoint = (d: unknown) => {
    const p = d as { payload?: Point } & Partial<Point>;
    const id = p.payload?.id ?? p.id;
    if (id) openSystem(id);
  };

  const overridden = points.filter((p) => p.time !== p.quadrant).length;
  const axisTick = { fill: palette.ink2, fontSize: 12 };
  const quadLabel = (text: string, position: 'insideTopLeft' | 'insideTopRight' | 'insideBottomLeft' | 'insideBottomRight') => ({
    value: text,
    position,
    fill: palette.ink2,
    fontSize: 12,
    fontWeight: 600,
  });

  return (
    <div className="view">
      <header className="view-head">
        <h2>TIME matrix</h2>
        <p>
          Business value against technical health for each system. Lines mark the thresholds ({vt.toFixed(1)} and {ht.toFixed(1)}); bubble
          area is today's annual run cost. Colour shows the final category, so a dot sitting in another quadrant was moved by an override
          (non-primary duplicate or critical EOL). Select a bubble for its full rationale.
        </p>
      </header>

      <div className="filters">
        <label>
          <span>Capability</span>
          <select value={l1} onChange={(e) => setL1(e.target.value as CapabilityL1 | '')}>
            <option value="">All</option>
            {l1s.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Origin</span>
          <select value={origin} onChange={(e) => setOrigin(e.target.value as Origin | '')}>
            <option value="">All</option>
            {(Object.keys(ORIGIN_LABEL) as Origin[]).map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Hosting</span>
          <select value={hosting} onChange={(e) => setHosting(e.target.value as Hosting | '')}>
            <option value="">All</option>
            {(Object.keys(HOSTING_LABEL) as Hosting[]).map((h) => (
              <option key={h} value={h}>
                {HOSTING_LABEL[h]}
              </option>
            ))}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Colour by">
          <button type="button" aria-pressed={colourBy === 'time'} onClick={() => setColourBy('time')}>
            Colour: TIME
          </button>
          <button type="button" aria-pressed={colourBy === 'capability'} onClick={() => setColourBy('capability')}>
            Colour: capability
          </button>
        </div>
        {colourBy === 'capability' && (
          <label>
            <span>Highlight</span>
            <select value={highlight} onChange={(e) => setHighlight(e.target.value as CapabilityL1)}>
              {l1s.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <section className="panel">
        <div className="legend-row">
          {series.map((s) => (
            <span key={s.key} className="legend-item">
              <span className="dot" style={{ background: s.colour }} />
              {s.label} <span className="muted num">{s.data.length}</span>
            </span>
          ))}
          <span className="legend-item muted">
            {points.length} shown, {overridden} moved by overrides
          </span>
        </div>
        <div className="chart chart-tall">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 12, bottom: 28, left: 0 }}>
              <CartesianGrid stroke={palette.grid} />
              <ReferenceArea x1={ht} x2={5} y1={vt} y2={5} fill="transparent" label={quadLabel('Invest', 'insideTopRight')} />
              <ReferenceArea x1={X_MIN} x2={ht} y1={vt} y2={5} fill="transparent" label={quadLabel('Migrate', 'insideTopLeft')} />
              <ReferenceArea x1={ht} x2={5} y1={1} y2={vt} fill="transparent" label={quadLabel('Tolerate', 'insideBottomRight')} />
              <ReferenceArea x1={X_MIN} x2={ht} y1={1} y2={vt} fill="transparent" label={quadLabel('Eliminate', 'insideBottomLeft')} />
              <XAxis
                type="number"
                dataKey="x"
                domain={[X_MIN, 5]}
                ticks={[1, 2, 3, 4, 5]}
                tick={axisTick}
                stroke={palette.axis}
                label={{ value: 'Technical health', position: 'insideBottom', offset: -16, fill: palette.ink2, fontSize: 12 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[1, 5]}
                ticks={[1, 2, 3, 4, 5]}
                tick={axisTick}
                stroke={palette.axis}
                width={36}
                label={{ value: 'Business value', angle: -90, position: 'insideLeft', offset: 12, fill: palette.ink2, fontSize: 12 }}
              />
              <ZAxis type="number" dataKey="z" range={[24, 520]} />
              <ReferenceLine x={ht} stroke={palette.ink2} strokeWidth={1} />
              <ReferenceLine y={vt} stroke={palette.ink2} strokeWidth={1} />
              <Tooltip cursor={false} content={<PointTip />} />
              {series.map((s) => (
                <Scatter
                  key={s.key}
                  name={s.label}
                  data={s.data}
                  fill={s.colour}
                  fillOpacity={0.82}
                  stroke={palette.surface}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                  onClick={onPoint}
                  cursor="pointer"
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function PointTip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="tip">
      <div className="tip-title">{p.name}</div>
      <div className="tip-sub">
        {p.l1} / {p.l2}
      </div>
      <table>
        <tbody>
          <tr>
            <td>TIME</td>
            <td>
              <strong>{cap(p.time)}</strong>
              {p.time !== p.quadrant && <span className="muted"> (scores say {p.quadrant})</span>}
            </td>
          </tr>
          <tr>
            <td>6R</td>
            <td>
              <strong>{cap(p.sixR)}</strong>
            </td>
          </tr>
          <tr>
            <td>Value / health</td>
            <td className="num">
              <strong>
                {p.y.toFixed(2)} / {p.x.toFixed(2)}
              </strong>
            </td>
          </tr>
          <tr>
            <td>Run cost</td>
            <td className="num">
              <strong>{nokM(p.z)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
