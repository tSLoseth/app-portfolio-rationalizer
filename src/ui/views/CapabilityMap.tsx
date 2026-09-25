import { useEffect, useMemo, useRef, useState } from 'react';
import type { CapabilityL1, SystemAssessment } from '../../model/types';
import { isPostMerger } from '../derive';
import { cap, nokM, originLabel } from '../format';
import type { ViewProps } from '../types';

interface Cell {
  key: string;
  l1: CapabilityL1;
  l2: string;
  systems: SystemAssessment[];
  cost: number;
  dupGroups: number;
  saasExample?: string;
}

export function CapabilityMap({ portfolio, result, palette, openSystem }: ViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const listRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selected) listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);

  const rows = useMemo(() => {
    const byL1 = new Map<CapabilityL1, Cell[]>();
    for (const c of portfolio.capabilities) {
      const systems = result.assessments.filter((a) => a.system.capability.l1 === c.l1 && a.system.capability.l2 === c.l2);
      const cell: Cell = {
        key: `${c.l1}/${c.l2}`,
        l1: c.l1,
        l2: c.l2,
        systems,
        cost: systems.reduce((t, a) => t + a.cost.baselineAnnual, 0),
        dupGroups: new Set(systems.map((a) => a.system.duplicateGroup).filter(Boolean)).size,
        ...(c.saasAlternativeExample ? { saasExample: c.saasAlternativeExample } : {}),
      };
      byL1.set(c.l1, [...(byL1.get(c.l1) ?? []), cell]);
    }
    return [...byL1.entries()];
  }, [portfolio, result]);

  const maxCount = Math.max(...rows.flatMap(([, cells]) => cells.map((c) => c.systems.length)));
  const shade = (n: number) => {
    const steps = palette.heat.length - 1;
    const i = n === 0 ? 0 : Math.max(1, Math.round((n / maxCount) * steps));
    return palette.heat[i]!;
  };
  const cell = rows.flatMap(([, c]) => c).find((c) => c.key === selected);

  return (
    <div className="view">
      <header className="view-head">
        <h2>Capability map</h2>
        <p>
          Business capabilities (L1 rows, L2 cells). Shading is the number of systems per capability; a marked cell holds at least one
          duplicate group{isPostMerger(portfolio.meta) ? ', the redundancy left by the acquisitions' : ''}. Select a cell to list its systems.
        </p>
      </header>

      <div className="legend-row">
        <span className="legend-item">
          Systems per capability
          <span className="heat-scale" aria-hidden="true">
            {palette.heat.map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
          <span className="muted num">0 to {maxCount}</span>
        </span>
        <span className="legend-item">
          <span className="dot" style={{ background: palette.add }} /> Contains duplicates
        </span>
      </div>

      <div className="capmap">
        {rows.map(([l1, cells]) => (
          <section className="cap-row" key={l1}>
            <h3 className="cap-l1">
              {l1}
              <span className="muted num">{nokM(cells.reduce((t, c) => t + c.cost, 0))}</span>
            </h3>
            <div className="cap-cells">
              {cells.map((c) => (
                  <button
                    type="button"
                    key={c.key}
                    className={`cap-cell${c.dupGroups ? ' dup' : ''}${selected === c.key ? ' selected' : ''}`}
                    style={{ background: shade(c.systems.length) }}
                    onClick={() => setSelected(selected === c.key ? null : c.key)}
                    aria-pressed={selected === c.key}
                  >
                    <span className="cap-l2">{c.l2}</span>
                    <span className="cap-meta num">
                      <strong>{c.systems.length}</strong> {c.systems.length === 1 ? 'system' : 'systems'}
                    </span>
                    <span className="cap-meta num">{nokM(c.cost)}/yr</span>
                    {c.dupGroups > 0 && (
                      <span className="cap-dup">
                        <span className="dot" style={{ background: palette.add }} />
                        {c.dupGroups} duplicate group{c.dupGroups > 1 ? 's' : ''}
                      </span>
                    )}
                  </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {cell && (
        <section className="panel" aria-live="polite" ref={listRef}>
          <h3 className="panel-title">
            {cell.l1} / {cell.l2}
          </h3>
          <p className="panel-sub">
            {cell.systems.length} systems, {nokM(cell.cost)} a year
            {cell.saasExample ? `. Market alternative: ${cell.saasExample}` : ''}
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>System</th>
                  <th>Origin</th>
                  <th>Duplicate group</th>
                  <th>TIME</th>
                  <th>6R</th>
                  <th className="r">Run cost</th>
                </tr>
              </thead>
              <tbody>
                {cell.systems.map((a) => (
                  <tr key={a.system.id} className="clickable" onClick={() => openSystem(a.system.id)}>
                    <td>
                      <button type="button" className="link" onClick={(e) => (e.stopPropagation(), openSystem(a.system.id))}>
                        {a.system.name}
                      </button>
                    </td>
                    <td>{originLabel(a.system.origin, portfolio.meta.originLabels)}</td>
                    <td>{a.system.duplicateGroup ? `${a.system.duplicateGroup}${a.system.isPrimary ? ' (primary)' : ''}` : ''}</td>
                    <td>
                      <span className="chip">
                        <span className="dot" style={{ background: palette.time[a.time.category] }} />
                        {cap(a.time.category)}
                      </span>
                    </td>
                    <td>{cap(a.sixR.sixR)}</td>
                    <td className="r num">{nokM(a.cost.baselineAnnual, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
