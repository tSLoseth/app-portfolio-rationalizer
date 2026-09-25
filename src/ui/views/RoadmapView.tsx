import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { quarterFromIndex, quarterIndex } from '../../engine/quarters';
import type { Quarter, Wave } from '../../model/types';
import { cap, num } from '../format';
import type { ViewProps } from '../types';
import { SystemTable } from './SystemTable';

const WAVE_NAME: Record<Wave, string> = {
  0: 'Wave 0: quick-win retirements',
  1: 'Wave 1: rehost and consolidation',
  2: 'Wave 2: replatform',
  3: 'Wave 3: refactor and repurchase',
};

const shortQ = (q: Quarter) => `${q.slice(2, 4)} ${q.slice(4)}`;

export function RoadmapView(props: ViewProps) {
  const { assumptions, result, palette, openSystem } = props;
  const rm = result.roadmap;
  const names = useMemo(() => new Map(result.assessments.map((a) => [a.system.id, a.system.name])), [result]);

  const q0 = quarterIndex(assumptions.roadmap.startQuarter.value);
  const q1 = quarterIndex(assumptions.roadmap.endQuarter.value);
  const quarters = Array.from({ length: q1 - q0 + 1 }, (_, i) => quarterFromIndex(q0 + i));
  const ms = quarterIndex(rm.dcExit.milestone) - q0 + 1;
  const col = (q: Quarter) => quarterIndex(q) - q0;

  const waves = ([0, 1, 2, 3] as Wave[]).map((w) => ({
    w,
    items: rm.items
      .filter((i) => i.wave === w)
      .sort((a, b) => quarterIndex(a.startQuarter) - quarterIndex(b.startQuarter) || quarterIndex(a.quarter) - quarterIndex(b.quarter)),
  }));

  const capData = rm.quarters.map((q) => ({ ...q, label: shortQ(q.quarter) }));
  const bridges = rm.cyclesBroken;
  const bridgeDays = rm.items.reduce((t, i) => t + i.bridgePersonDays, 0);
  const axisTick = { fill: palette.ink2, fontSize: 11 };
  const n = quarters.length;

  return (
    <div className="view">
      <header className="view-head">
        <h2>Roadmap</h2>
        <p>
          {rm.items.length} systems scheduled in four waves from {quarters[0]} to {quarters[n - 1]}, respecting dependencies and a capacity of{' '}
          {rm.capacity.maxCutoversPerQuarter} cutovers and {num(rm.capacity.maxPersonDaysPerQuarter)} person-days per quarter.{' '}
          {rm.retained.length} retained systems are not scheduled.{' '}
          {rm.dcExit.achieved
            ? `All ${rm.dcExit.inScope} data-center systems are out by ${rm.dcExit.exitQuarter}, meeting the ${rm.dcExit.milestone} deadline.`
            : `${rm.dcExit.violations.length} data-center systems miss the ${rm.dcExit.milestone} deadline.`}
        </p>
      </header>

      <section className="panel">
        <div className="legend-row">
          <span className="legend-item">
            <span className="swatch" style={{ background: palette.accent }} /> Leaves the data center
          </span>
          <span className="legend-item">
            <span className="swatch" style={{ background: palette.muted }} /> Other move
          </span>
          <span className="legend-item">
            <span className="line-key dashed" style={{ borderColor: palette.add }} /> DC exit deadline {rm.dcExit.milestone}
          </span>
        </div>
        <div className="gantt-scroll">
          <div className="gantt" style={{ ['--cols' as string]: n }}>
            <div className="gantt-head">
              <span className="gantt-name" />
              <div className="gantt-track">
                {quarters.map((q) => (
                  <span key={q} className="gantt-q num">
                    {shortQ(q)}
                  </span>
                ))}
              </div>
            </div>
            {waves.map(({ w, items }) =>
              items.length ? (
                <details key={w} open className="gantt-wave">
                  <summary>
                    {WAVE_NAME[w]} <span className="muted num">{items.length}</span>
                  </summary>
                  {items.map((i) => {
                    const s = col(i.startQuarter);
                    const e = col(i.quarter);
                    return (
                      <button
                        type="button"
                        key={i.systemId}
                        className="gantt-row"
                        onClick={() => openSystem(i.systemId)}
                        title={`${names.get(i.systemId)}: ${cap(i.sixR)}, ${i.startQuarter} to ${i.quarter}, ${Math.round(i.personDays)} person-days`}
                      >
                        <span className="gantt-name">{names.get(i.systemId)}</span>
                        <span className="gantt-track">
                          <span
                            className="gantt-bar"
                            style={{
                              left: `${(s / n) * 100}%`,
                              width: `${((e - s + 1) / n) * 100}%`,
                              background: i.dcScope ? palette.accent : palette.muted,
                            }}
                          />
                          {i.temporaryIntegrations.length > 0 && (
                            <span className="gantt-bridge" style={{ left: `${((e + 1) / n) * 100}%` }} aria-label="needs temporary integration">
                              ⇄
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </details>
              ) : null,
            )}
            <div className="gantt-milestone" style={{ ['--ms' as string]: ms, borderColor: palette.add }} aria-hidden="true" />
          </div>
        </div>
        <p className="note">⇄ marks a cutover that needs a temporary integration to a dependency that has not moved yet.</p>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h3 className="panel-title">Delivery capacity used</h3>
          <p className="panel-sub">Person-days per quarter against the {num(rm.capacity.maxPersonDaysPerQuarter)} cap</p>
          <div className="chart chart-short">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={capData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={palette.grid} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} stroke={palette.axis} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={axisTick} stroke={palette.axis} width={40} tickLine={false} axisLine={false} />
                <ReferenceLine
                  y={rm.capacity.maxPersonDaysPerQuarter}
                  stroke={palette.add}
                  strokeDasharray="4 3"
                  label={{ value: 'Capacity', position: 'insideTopRight', fill: palette.ink2, fontSize: 11 }}
                />
                <Tooltip cursor={{ fill: palette.grid, opacity: 0.5 }} content={<CapTip max={rm.capacity.maxPersonDaysPerQuarter} />} />
                <Bar dataKey="personDays" fill={palette.accent} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <h3 className="panel-title">Dependency cycles broken</h3>
          <p className="panel-sub">
            {bridges.length} cycles in the integration graph; {bridges.filter((b) => b.temporaryIntegration).length} need a bridge.{' '}
            {Math.round(bridgeDays)} bridge person-days in total.
          </p>
          <ul className="cycles">
            {bridges.map((b) => (
              <li key={b.cycle.join('>')}>
                <div className="cycle-path">{b.cycle.map((id) => names.get(id) ?? id).join(' → ')}</div>
                <div className="muted">
                  Cut {names.get(b.cutEdge.from)} → {names.get(b.cutEdge.to)}:{' '}
                  {b.temporaryIntegration ? `temporary integration, ${b.personDays} person-days` : 'no bridge needed'}
                </div>
              </li>
            ))}
          </ul>
          {bridges[0] && <p className="note">Rule: {bridges[0].rule}</p>}
        </section>
      </div>

      <SystemTable {...props} />
    </div>
  );
}

function CapTip({ active, payload, max }: { active?: boolean; payload?: { payload: { quarter: string; personDays: number; cutovers: number } }[]; max: number }) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  return (
    <div className="tip">
      <div className="tip-value num">{num(d.personDays)} person-days</div>
      <div className="tip-sub">
        {d.quarter}: {Math.round((d.personDays / max) * 100)}% of capacity, {d.cutovers} cutovers
      </div>
    </div>
  );
}
