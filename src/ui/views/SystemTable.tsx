import { useMemo, useState } from 'react';
import { quarterIndex } from '../../engine/quarters';
import type { SixR, SystemAssessment, TimeCategory } from '../../model/types';
import { cap, nokM, SIXR_ORDER, TIME_ORDER } from '../format';
import type { ViewProps } from '../types';

type Key = 'name' | 'capability' | 'time' | 'sixR' | 'now' | 'target' | 'oneOff' | 'cutover';

const COLS: { key: Key; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'System' },
  { key: 'capability', label: 'Capability' },
  { key: 'time', label: 'TIME' },
  { key: 'sixR', label: '6R' },
  { key: 'now', label: 'Run cost now', numeric: true },
  { key: 'target', label: 'Target', numeric: true },
  { key: 'oneOff', label: 'One-off', numeric: true },
  { key: 'cutover', label: 'Cutover' },
];

const value = (a: SystemAssessment, k: Key): string | number => {
  switch (k) {
    case 'name':
      return a.system.name.toLowerCase();
    case 'capability':
      return `${a.system.capability.l1} ${a.system.capability.l2}`;
    case 'time':
      return TIME_ORDER.indexOf(a.time.category);
    case 'sixR':
      return SIXR_ORDER.indexOf(a.sixR.sixR);
    case 'now':
      return a.cost.baselineAnnual;
    case 'target':
      return a.cost.targetAnnual;
    case 'oneOff':
      return a.cost.oneOffMigration;
    case 'cutover':
      return a.roadmap ? quarterIndex(a.roadmap.quarter) : Number.MAX_SAFE_INTEGER;
  }
};

export function SystemTable({ result, palette, openSystem }: ViewProps) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'now', dir: -1 });
  const [q, setQ] = useState('');
  const [time, setTime] = useState<TimeCategory | ''>('');
  const [sixR, setSixR] = useState<SixR | ''>('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return result.assessments
      .filter(
        (a) =>
          (!time || a.time.category === time) &&
          (!sixR || a.sixR.sixR === sixR) &&
          (!needle ||
            `${a.system.name} ${a.system.vendor} ${a.system.id} ${a.system.capability.l1} ${a.system.capability.l2}`.toLowerCase().includes(needle)),
      )
      .sort((x, y) => {
        const a = value(x, sort.key);
        const b = value(y, sort.key);
        return (a < b ? -1 : a > b ? 1 : 0) * sort.dir;
      });
  }, [result, q, time, sixR, sort]);

  const toggle = (key: Key) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: COLS.find((c) => c.key === key)?.numeric ? -1 : 1 }));

  return (
    <section className="panel">
      <h3 className="panel-title">All systems</h3>
      <p className="panel-sub">Select a row for attributes, sub-scores and the full rule trace</p>
      <div className="filters">
        <label className="grow">
          <span>Search</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, vendor or capability" />
        </label>
        <label>
          <span>TIME</span>
          <select value={time} onChange={(e) => setTime(e.target.value as TimeCategory | '')}>
            <option value="">All</option>
            {TIME_ORDER.map((t) => (
              <option key={t} value={t}>
                {cap(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>6R</span>
          <select value={sixR} onChange={(e) => setSixR(e.target.value as SixR | '')}>
            <option value="">All</option>
            {SIXR_ORDER.map((r) => (
              <option key={r} value={r}>
                {cap(r)}
              </option>
            ))}
          </select>
        </label>
        <span className="count muted num">{rows.length} systems</span>
      </div>
      <div className="table-wrap tall">
        <table className="data-table">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={c.numeric ? 'r' : undefined}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="th-btn" onClick={() => toggle(c.key)}>
                    {c.label}
                    <span className="sort-ind" aria-hidden="true">
                      {sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.system.id} className="clickable" onClick={() => openSystem(a.system.id)}>
                <td>
                  <button type="button" className="link" onClick={(e) => (e.stopPropagation(), openSystem(a.system.id))}>
                    {a.system.name}
                  </button>
                </td>
                <td className="muted wrap">
                  {a.system.capability.l1} / {a.system.capability.l2}
                </td>
                <td>
                  <span className="chip">
                    <span className="dot" style={{ background: palette.time[a.time.category] }} />
                    {cap(a.time.category)}
                  </span>
                </td>
                <td>{cap(a.sixR.sixR)}</td>
                <td className="r num">{nokM(a.cost.baselineAnnual, 2)}</td>
                <td className="r num">{nokM(a.cost.targetAnnual, 2)}</td>
                <td className="r num">{a.cost.oneOffMigration ? nokM(a.cost.oneOffMigration, 2) : '–'}</td>
                <td className="num">{a.roadmap?.quarter ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
