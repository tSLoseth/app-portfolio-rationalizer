import { useEffect, useRef } from 'react';
import type { Origin, SystemAssessment } from '../../model/types';
import { aiRationale } from '../derive';
import { cap, HOSTING_LABEL, nokM, num, originLabel } from '../format';

interface Props {
  assessment: SystemAssessment;
  all: SystemAssessment[];
  originLabels?: Partial<Record<Origin, string>>;
  onClose: () => void;
  onOpen: (id: string) => void;
}

const FLAG_TEXT: Record<string, string> = {
  requires_eu_no_region: 'Data residency: requires an EU/Norway cloud region',
  site_bound: 'Site-bound plant/OT system: outside the DC-exit scope',
  dc_exit_forced: 'Moved because the data center closes, not on scores',
  consolidation: 'Consolidation: users and data migrate into the group standard',
  shadow_it_governance: 'Shadow IT: needs an owner and a governance decision',
  critical_consolidation: 'Business-critical duplicate with imminent EOL: a real migration project',
};

export function SystemDetail({ assessment: a, all, originLabels, onClose, onOpen }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const s = a.system;
  const byId = new Map(all.map((x) => [x.system.id, x]));
  const name = (id: string) => byId.get(id)?.system.name ?? id;
  const dependants = all.filter((x) => x.system.integrations.includes(s.id));
  const consolidateInto = a.sixR.consolidateInto ?? a.time.consolidateInto;
  const ai = aiRationale[s.id];

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, s.id]);

  const flags = [
    ...a.time.flags,
    ...a.sixR.flags,
    ...(s.residencyRequired && !a.sixR.flags.includes('requires_eu_no_region') ? ['residency_required'] : []),
    ...(s.isPrimary ? ['consolidation_target'] : []),
  ];
  const flagText = (f: string) =>
    FLAG_TEXT[f] ??
    (f === 'residency_required'
      ? 'Data must stay in the EU/EEA or Norway'
      : f === 'consolidation_target'
        ? `Consolidation target: group standard for ${s.duplicateGroup}`
        : f);

  const sub = (label: string, v: number) => (
    <div className="score" key={label}>
      <span>{label}</span>
      <span className="score-bar" aria-hidden="true">
        <span style={{ width: `${(v / 5) * 100}%` }} />
      </span>
      <strong className="num">{v}</strong>
    </div>
  );

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <p className="drawer-id muted">
              {s.id}, {s.vendor}
            </p>
            <h2 id="drawer-title">{s.name}</h2>
            <p className="drawer-cap">
              {s.capability.l1} / {s.capability.l2}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} ref={closeRef} aria-label="Close details">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          <p>{s.description}</p>

          <div className="verdict">
            <div>
              <span className="muted">TIME</span>
              <strong>{cap(a.time.category)}</strong>
            </div>
            <div>
              <span className="muted">6R</span>
              <strong>{cap(a.sixR.sixR)}</strong>
            </div>
            <div>
              <span className="muted">Cutover</span>
              <strong>{a.roadmap ? `${a.roadmap.quarter} (wave ${a.roadmap.wave})` : 'Not scheduled'}</strong>
            </div>
          </div>

          {flags.length > 0 && (
            <ul className="flags">
              {flags.map((f) => (
                <li key={f}>
                  <span aria-hidden="true">⚑</span> {flagText(f)}
                </li>
              ))}
            </ul>
          )}

          {ai && (
            <section className="ai-box">
              <h3>AI-generated explanation (Claude Haiku 4.5) — decision made by rules engine</h3>
              <p>{ai.text}</p>
            </section>
          )}

          <section>
            <h3>Cost</h3>
            <dl className="kv">
              <dt>Run cost today</dt>
              <dd className="num">{nokM(a.cost.baselineAnnual, 2)}</dd>
              <dt>Target run cost</dt>
              <dd className="num">{nokM(a.cost.targetAnnual, 2)}</dd>
              <dt>Annual saving</dt>
              <dd className="num">{nokM(a.cost.annualSaving, 2)}</dd>
              <dt>One-off cost</dt>
              <dd className="num">{nokM(a.cost.oneOffMigration, 2)}</dd>
              <dt>Simple payback</dt>
              <dd className="num">
                {a.sixR.sixR === 'retain' ? 'Not applicable' : a.cost.paybackYears === null ? 'None on run cost' : `${a.cost.paybackYears.toFixed(1)} years`}
              </dd>
              <dt>Cost split today</dt>
              <dd className="num">
                licence {nokM(s.annualCost.license)}, infra {nokM(s.annualCost.infra)}, support staff {nokM(s.annualCost.supportFte)}, vendor{' '}
                {nokM(s.annualCost.vendorSupport)}
              </dd>
            </dl>
          </section>

          <section>
            <h3>Scores</h3>
            <div className="scores">
              <div>
                <p className="score-head">
                  Business value <strong className="num">{a.time.businessValue.toFixed(2)}</strong>
                </p>
                {sub('Functional coverage', s.businessFit.functionalCoverage)}
                {sub('User satisfaction', s.businessFit.userSatisfaction)}
                {sub('Strategic relevance', s.businessFit.strategicRelevance)}
                {sub('Business criticality', s.businessCriticality)}
              </div>
              <div>
                <p className="score-head">
                  Technical health <strong className="num">{a.time.technicalHealth.toFixed(2)}</strong>
                  {a.time.eolPenalty > 0 && <span className="muted"> (incl. EOL penalty −{a.time.eolPenalty})</span>}
                </p>
                {sub('Supportability', s.technicalFit.supportability)}
                {sub('Security', s.technicalFit.security)}
                {sub('Scalability', s.technicalFit.scalability)}
                {sub('Documentation', s.technicalFit.documentation)}
                {sub('EOL risk (5 = far off)', s.technicalFit.eolRisk)}
              </div>
            </div>
          </section>

          <section>
            <h3>Rule trace</h3>
            {s.importNotes && <Trace title="Data import (assumed or derived values)" lines={s.importNotes} />}
            <Trace title="TIME" lines={a.time.rationale} />
            <Trace title="6R" lines={a.sixR.rationale} />
            <Trace title="Cost" lines={a.cost.rationale} />
            {a.roadmap && <Trace title="Roadmap" lines={a.roadmap.rationale} />}
          </section>

          <section>
            <h3>Attributes</h3>
            <dl className="kv">
              <dt>Origin</dt>
              <dd>{originLabel(s.origin, originLabels)}</dd>
              <dt>Type / hosting</dt>
              <dd>
                {s.type.toUpperCase()}, {HOSTING_LABEL[s.hosting]}
              </dd>
              <dt>Tech stack</dt>
              <dd>{s.techStack.join(', ')}</dd>
              <dt>Platform EOL</dt>
              <dd className="num">
                {s.platformEolYear ?? 'Vendor-managed'}
                {a.time.yearsToEol !== null && a.time.yearsToEol < 0 && ' (expired)'}
              </dd>
              <dt>Last major upgrade</dt>
              <dd className="num">{s.lastMajorUpgrade}</dd>
              <dt>Users</dt>
              <dd className="num">{num(s.users)}</dd>
              <dt>Size class</dt>
              <dd>{s.sizeClass}</dd>
              <dt>Data sensitivity</dt>
              <dd>
                {cap(s.dataSensitivity.replace('_', ' '))}
                {s.residencyRequired ? ', residency required' : ''}
              </dd>
              {s.duplicateGroup && (
                <>
                  <dt>Duplicate group</dt>
                  <dd>
                    {s.duplicateGroup}
                    {s.isPrimary ? ' (primary)' : ''}
                  </dd>
                </>
              )}
              {consolidateInto && (
                <>
                  <dt>Consolidates into</dt>
                  <dd>
                    <button type="button" className="link" onClick={() => onOpen(consolidateInto)}>
                      {name(consolidateInto)}
                    </button>
                    {a.sixR.consolidationTargetFuture && (
                      <span className="muted">
                        {' '}
                        → its {a.sixR.consolidationTargetFuture.futureState}
                        {byId.get(consolidateInto)?.roadmap ? `, go-live ${byId.get(consolidateInto)!.roadmap!.quarter}` : ''}
                      </span>
                    )}
                  </dd>
                </>
              )}
              <dt>Depends on ({s.integrations.length})</dt>
              <dd>
                <Links ids={s.integrations} name={name} onOpen={onOpen} />
              </dd>
              <dt>Used by ({dependants.length})</dt>
              <dd>
                <Links ids={dependants.map((d) => d.system.id)} name={name} onOpen={onOpen} />
              </dd>
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Trace({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="trace">
      <h4>{title}</h4>
      <ol>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
    </div>
  );
}

function Links({ ids, name, onOpen }: { ids: string[]; name: (id: string) => string; onOpen: (id: string) => void }) {
  if (!ids.length) return <span className="muted">None</span>;
  return (
    <span className="links">
      {ids.map((id) => (
        <button type="button" key={id} className="link" onClick={() => onOpen(id)}>
          {name(id)}
        </button>
      ))}
    </span>
  );
}
