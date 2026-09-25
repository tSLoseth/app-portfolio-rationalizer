import { findings, headline, kpis } from '../derive';
import { cap, nokM, pct, SIXR_ORDER, TIME_ORDER } from '../format';
import type { ViewProps } from '../types';

export function Overview({ portfolio, assumptions, result, palette }: ViewProps) {
  const k = kpis(portfolio, result);
  const f = findings(result, assumptions, portfolio.meta);
  const n = result.assessments.length;

  const timeCounts = TIME_ORDER.map((t) => ({ t, n: result.assessments.filter((a) => a.time.category === t).length }));
  const sixR = SIXR_ORDER.map((r) => ({ r, ...result.cost.bySixR[r] }));
  const maxSixR = Math.max(...sixR.map((x) => x.count));

  return (
    <div className="view">
      <section className="hero">
        <p className="hero-kicker">Recommendation</p>
        <h2 className="hero-line">{headline(result)}</h2>
      </section>

      <section className="kpis" aria-label="Key figures">
        <Kpi label="Systems assessed" value={String(k.systems)} sub={`${k.duplicateSystems} sit in duplicate groups`} />
        <Kpi label="Annual IT run cost" value={nokM(k.runCost)} sub={k.facilityCost > 0 ? 'incl. data-center facility' : 'listed systems only'} />
        <Kpi label="Hosted on-prem" value={pct(k.onPremShare)} sub="of systems, in the DC or at plants" />
        <Kpi label="Duplicate groups" value={String(k.duplicateGroups)} sub={k.postMerger ? 'same L2 capability, post-M&A' : 'overlap within the same L2 capability'} />
        <Kpi label={`${result.cost.horizonYears}-year NPV`} value={nokM(k.npv)} sub={`at ${pct(result.cost.discountRate, 1)} discount rate`} />
        <Kpi
          label="Simple payback (steady state)"
          value={k.paybackYears === null ? 'None' : `${k.paybackYears.toFixed(1)} yrs`}
          sub="one-off ÷ annual run-cost saving"
        />
        <Kpi
          label="Cash break-even"
          value={k.paybackQuarter ?? 'Not reached'}
          sub={k.paybackQuarter ? 'cumulative cash flow turns positive' : 'cumulative cash flow stays negative'}
        />
        {k.dcInScope > 0 ? (
          <Kpi
            label="Data-center exit"
            value={k.dcExitQuarter ?? 'Not met'}
            sub={k.dcAchieved ? `meets the ${k.milestone} deadline` : `misses the ${k.milestone} deadline`}
            warn={!k.dcAchieved}
          />
        ) : (
          <Kpi label="Data-center exit" value="Not in scope" sub="no data-center-hosted systems" />
        )}
      </section>

      <section className="findings" aria-label="Key findings">
        {f.map((x, i) => (
          <article className="finding" key={x.title}>
            <span className="finding-no" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <h3>{x.title}</h3>
              <p>{x.body}</p>
            </div>
          </article>
        ))}
      </section>

      <div className="grid-2">
        <section className="panel">
          <h3 className="panel-title">TIME distribution</h3>
          <p className="panel-sub">Share of {n} systems by final category (after overrides)</p>
          <div className="stack-bar" role="img" aria-label={timeCounts.map((x) => `${x.t} ${x.n}`).join(', ')}>
            {timeCounts.map((x) =>
              x.n ? (
                <div
                  key={x.t}
                  className="stack-seg"
                  style={{ flexGrow: x.n, background: palette.time[x.t] }}
                  title={`${cap(x.t)}: ${x.n} systems (${pct(x.n / n)})`}
                />
              ) : null,
            )}
          </div>
          <ul className="legend-list">
            {timeCounts.map((x) => (
              <li key={x.t}>
                <span className="swatch" style={{ background: palette.time[x.t] }} />
                <span className="legend-name">{cap(x.t)}</span>
                <span className="legend-val num">
                  {x.n} <span className="muted">({pct(x.n / n)})</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h3 className="panel-title">6R distribution</h3>
          <p className="panel-sub">Systems per migration strategy, with today's run cost in scope</p>
          <ul className="hbars">
            {sixR.map((x) => (
              <li key={x.r} title={`${cap(x.r)}: ${x.count} systems, ${nokM(x.baselineAnnual)} run cost today`}>
                <span className="hbar-label">{cap(x.r)}</span>
                <span className="hbar-track">
                  <span className="hbar" style={{ width: `${(x.count / maxSixR) * 100}%`, background: palette.accent }} />
                </span>
                <span className="hbar-val num">{x.count}</span>
                <span className="hbar-extra num muted">{nokM(x.baselineAnnual)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={warn ? 'kpi warn' : 'kpi'}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">
        {warn && <span aria-hidden="true">⚠ </span>}
        {sub}
      </div>
    </div>
  );
}
