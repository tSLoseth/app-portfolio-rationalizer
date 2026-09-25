import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { decodeBytes, parseCsv, toCsv, type CsvTable } from '../../import/csv';
import { readMappingJson, suggestMapping, toMapping, type HeaderMatch } from '../../import/mapping';
import { FIELD_BY_KEY, TARGET_FIELDS, templateRows, validateMapping, type FieldGroup } from '../../import/schema';
import { HOSTING_LABEL, nokM } from '../format';
import { buildFrom } from '../importState';
import type { ViewProps } from '../types';

interface Draft {
  fileName: string;
  text: string;
  table: CsvTable;
  encoding: string;
}

const GROUPS: FieldGroup[] = ['Identity', 'Capability', 'Classification', 'Lifecycle', 'Scores', 'Cost', 'Relations'];
const SAMPLE_URL = `${import.meta.env.BASE_URL}sample-inventory.csv`;
const DELIMITER_NAME: Record<string, string> = { ';': 'semicolon', ',': 'comma', '\t': 'tab', '|': 'pipe' };
const KIND_LABEL: Record<HeaderMatch['kind'], string> = {
  exact: 'Exact',
  synonym: 'Synonym',
  partial: 'Partial',
  fuzzy: 'Fuzzy',
  none: 'No match',
  manual: 'Manual',
  ai: 'From JSON',
};

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const shorten = (s: string, n = 36) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function ImportView({ imported, onImport, onResetImport }: ViewProps) {
  const initial = useMemo(() => {
    if (!imported) return null;
    const table = parseCsv(imported.source.text);
    const matches = suggestMapping(table.headers);
    for (const h of table.headers) {
      const f = imported.source.mapping[h] ?? null;
      if (f !== matches[h]?.field) matches[h] = { field: f, confidence: 1, kind: 'manual' };
    }
    return { draft: { fileName: imported.source.fileName, text: imported.source.text, table, encoding: 'utf-8' }, matches };
  }, [imported]);

  const [draft, setDraft] = useState<Draft | null>(initial?.draft ?? null);
  const [matches, setMatches] = useState<Record<string, HeaderMatch>>(initial?.matches ?? {});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mappingInput = useRef<HTMLInputElement>(null);

  const start = (fileName: string, text: string, encoding: string) => {
    const table = parseCsv(text);
    if (!table.headers.length || !table.rows.length) {
      setError(`${fileName}: no data rows found. The first row must hold the column names.`);
      return;
    }
    setDraft({ fileName, text, table, encoding });
    setMatches(suggestMapping(table.headers));
    setError(null);
    setNote(encoding === 'utf-8' ? null : `The file is not UTF-8; it was read as ${encoding} (typical for Excel CSV exports).`);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { text, encoding } = decodeBytes(new Uint8Array(await file.arrayBuffer()));
      start(file.name, text, encoding);
    } catch (err) {
      setError(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const loadSample = async () => {
    setBusy(true);
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { text, encoding } = decodeBytes(new Uint8Array(await res.arrayBuffer()));
      start('sample-inventory.csv', text, encoding);
    } catch (err) {
      setError(`Could not load the sample: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // Demo deep link: /?sample#import opens the flow with the sample already loaded.
  useEffect(() => {
    if (!draft && new URLSearchParams(location.search).has('sample')) void loadSample();
  }, []);

  const onMappingFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !draft) return;
    try {
      const { matches: m, dropped } = readMappingJson(JSON.parse(await file.text()), draft.table.headers);
      setMatches(m);
      const n = Object.values(m).filter((x) => x.field).length;
      setNote(
        `Loaded ${n} column mappings from ${file.name}. A model proposed them; review every row before confirming.` +
          (dropped.length ? ` Ignored: ${dropped.join('; ')}.` : ''),
      );
      setError(null);
    } catch (err) {
      setError(`${file.name} is not a valid mapping file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const mapping = useMemo(() => toMapping(matches), [matches]);
  const issues = useMemo(() => (draft ? validateMapping(mapping) : []), [draft, mapping]);
  const errors = issues.filter((i) => i.level === 'error');
  const built = useMemo(() => {
    if (!draft) return null;
    try {
      return buildFrom(draft.table, draft.fileName, mapping);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [draft, mapping]);
  const buildError = built && 'error' in built ? built.error : null;
  const preview = built && !('error' in built) ? built : null;

  const samples = (i: number) =>
    [...new Set(draft!.table.rows.map((r) => r[i] ?? '').filter((v) => v.trim()))].slice(0, 3).map((v) => shorten(v.replace(/\s+/g, ' ')));
  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const unmapped = TARGET_FIELDS.filter((f) => !mappedFields.has(f.key));

  const setField = (header: string, field: string) =>
    setMatches((m) => ({ ...m, [header]: { field: field || null, confidence: 1, kind: 'manual' } }));

  const r = preview?.report;
  const assumed = (id: string, ...keys: string[]) => keys.some((k) => r?.assumedBySystem[id]?.includes(k));
  const cls = (id: string, ...keys: string[]) => (assumed(id, ...keys) ? 'assumed' : undefined);

  return (
    <div className="view import-view">
      <header className="view-head">
        <h2>Bring your own inventory</h2>
        <p>
          Upload a CSV export from a CMDB or spreadsheet. Columns are matched to the schema by fixed rules, you confirm the mapping, and
          the same engine then runs on your systems. Everything stays in this browser: nothing is uploaded and no AI runs here.
        </p>
      </header>

      {imported && (
        <p className="callout">
          The dashboard shows <strong>{imported.source.fileName}</strong> ({imported.portfolio.systems.length} systems). Change the mapping
          below and confirm again, or{' '}
          <button type="button" className="link" onClick={onResetImport}>
            reset to the demo portfolio
          </button>
          .
        </p>
      )}

      <section className="panel">
        <h3 className="panel-title">Source</h3>
        <div className="import-actions">
          <label className="btn btn-primary file-btn">
            Choose CSV file…
            <input type="file" accept=".csv,.txt,text/csv" onChange={onFile} />
          </label>
          <button type="button" className="btn" onClick={loadSample} disabled={busy}>
            Load sample (25 systems)
          </button>
          <button type="button" className="btn" onClick={() => download('inventory-template.csv', `﻿${toCsv(templateRows())}`, 'text/csv;charset=utf-8')}>
            Download template
          </button>
          <a className="link" href={SAMPLE_URL} download="sample-inventory.csv">
            Download the sample CSV
          </a>
        </div>
        <p className="note">
          Delimiter (; , tab or |), quotes, a byte-order mark and Excel's Windows-1252 encoding are detected. Norwegian numbers such as
          1 250 000, 2,1 mill and kr 95 000,- are understood; scores on 1–10 or 0–100 are rescaled to 1–5.
        </p>
        {error && (
          <p className="import-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {draft && (
        <>
          <section className="panel">
            <div className="panel-head-row">
              <div>
                <h3 className="panel-title">1. Map columns</h3>
                <p className="panel-sub">
                  <strong>{draft.fileName}</strong>: {draft.table.rows.length} rows, {draft.table.headers.length} columns,{' '}
                  {DELIMITER_NAME[draft.table.delimiter] ?? draft.table.delimiter}-delimited. Suggestions come from header rules; change any row.
                </p>
              </div>
              <div className="import-actions">
                <button type="button" className="btn" onClick={() => mappingInput.current?.click()}>
                  Load mapping JSON
                </button>
                <input ref={mappingInput} type="file" accept=".json,application/json" hidden onChange={onMappingFile} />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setMatches(suggestMapping(draft.table.headers));
                    setNote(null);
                  }}
                >
                  Reset to suggestions
                </button>
              </div>
            </div>
            {note && <p className="callout import-note">{note}</p>}
            <div className="table-wrap tall">
              <table className="data-table mapping-table">
                <thead>
                  <tr>
                    <th>Column in file</th>
                    <th>Sample values</th>
                    <th>Maps to</th>
                    <th>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.table.headers.map((h, i) => {
                    const m = matches[h] ?? { field: null, confidence: 0, kind: 'none' as const };
                    return (
                      <tr key={h} className={m.field ? undefined : 'unmapped'}>
                        <td className="col-name">
                          {h}
                          <span className="samples-inline muted">{samples(i).join(' · ') || '(empty)'}</span>
                        </td>
                        <td className="samples muted">{samples(i).join(' · ') || '(empty)'}</td>
                        <td>
                          <select value={m.field ?? ''} onChange={(e) => setField(h, e.target.value)} aria-label={`Target field for ${h}`}>
                            <option value="">Ignore this column</option>
                            {GROUPS.map((g) => (
                              <optgroup key={g} label={g}>
                                {TARGET_FIELDS.filter((f) => f.group === g).map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}
                                    {f.key === 'name' ? ' (required)' : ''}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className={`tag match-${m.kind}`} title={m.via ? `Matched on "${m.via}"` : undefined}>
                            {KIND_LABEL[m.kind]}
                            {m.field && m.kind !== 'manual' ? ` ${Math.round(m.confidence * 100)}%` : ''}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="defaults">
              <summary>
                {unmapped.length} schema fields are not in the file and will be defaulted
              </summary>
              <ul className="defaults-list">
                {unmapped.map((f) => (
                  <li key={f.key}>
                    <span>{f.label}</span>
                    <span className="muted">{f.defaultText}</span>
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section className="panel">
            <h3 className="panel-title">2. Check the result</h3>
            {issues.length > 0 && (
              <ul className="issues">
                {issues.map((i) => (
                  <li key={i.text} className={i.level}>
                    <span aria-hidden="true">{i.level === 'error' ? '✕' : '⚠'}</span> {i.text}
                  </li>
                ))}
              </ul>
            )}
            {buildError && <p className="import-error">Could not build the portfolio: {buildError}</p>}
            {r && preview && (
              <>
                <ul className="import-stats">
                  <li>
                    <strong className="num">{r.systems}</strong> systems
                    {r.skipped.length > 0 && <span className="muted"> ({r.skipped.length} rows without a name skipped)</span>}
                  </li>
                  <li>
                    <strong className="num">{r.capabilityMatches.exact + r.capabilityMatches.keyword + r.capabilityMatches.fuzzy}</strong> placed on the
                    capability map, <strong className="num">{r.capabilityMatches.created}</strong> in new capabilities
                    {r.newCapabilities.length > 0 && <span className="muted"> ({r.newCapabilities.map((c) => `${c.l1} / ${c.l2}`).join(', ')}; SaaS alternative assumed)</span>}
                  </li>
                  <li>
                    <strong className="num">{r.duplicateGroups}</strong> overlap groups
                    {r.primariesAssumed.length > 0 && <span className="muted"> (group standard assumed for {r.primariesAssumed.length})</span>}
                  </li>
                  {r.rescaled.map((x) => (
                    <li key={x.field}>
                      “{x.header}” read as a 1–{x.scale} scale and rescaled to 1–5
                    </li>
                  ))}
                  {r.unreadable.length > 0 && (
                    <li className="warn">
                      <strong className="num">{r.unreadable.length}</strong> unreadable cell{r.unreadable.length > 1 ? 's' : ''} defaulted:{' '}
                      {r.unreadable.slice(0, 4).map((u) => `row ${u.row} ${FIELD_BY_KEY.get(u.field)?.label ?? u.field} “${shorten(u.value, 24)}”`).join(', ')}
                      {r.unreadable.length > 4 ? ' …' : ''}
                    </li>
                  )}
                  {r.unresolvedIntegrations.length > 0 && (
                    <li className="warn">
                      <strong className="num">{r.unresolvedIntegrations.length}</strong> integrations point to systems not in the file and are ignored
                    </li>
                  )}
                </ul>

                <h4 className="preview-title">Preview: first {Math.min(5, preview.portfolio.systems.length)} systems after normalisation</h4>
                <div className="table-wrap">
                  <table className="data-table compact preview-table">
                    <thead>
                      <tr>
                        <th>System</th>
                        <th>Capability</th>
                        <th>Type</th>
                        <th>Hosting</th>
                        <th className="r">Criticality</th>
                        <th className="r">Business fit</th>
                        <th className="r">Tech fit</th>
                        <th className="r">Platform EOL</th>
                        <th className="r">Run cost</th>
                        <th>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.portfolio.systems.slice(0, 5).map((s) => {
                        const bf = (s.businessFit.functionalCoverage + s.businessFit.userSatisfaction + s.businessFit.strategicRelevance) / 3;
                        const t = s.technicalFit;
                        const tf = (t.supportability + t.security + t.scalability + t.documentation + t.eolRisk) / 5;
                        const cost = Object.values(s.annualCost).reduce((a, b) => a + b, 0);
                        return (
                          <tr key={s.id}>
                            <td>{s.name}</td>
                            <td className={cls(s.id, 'capability')}>
                              {s.capability.l1} / {s.capability.l2}
                            </td>
                            <td className={cls(s.id, 'type')}>{s.type.toUpperCase()}</td>
                            <td className={cls(s.id, 'hosting')}>
                              {HOSTING_LABEL[s.hosting]}
                              {s.siteBound ? ' (site)' : ''}
                            </td>
                            <td className={`r num ${cls(s.id, 'businessCriticality') ?? ''}`}>{s.businessCriticality}</td>
                            <td className={`r num ${cls(s.id, 'functionalCoverage', 'userSatisfaction', 'strategicRelevance') ?? ''}`}>{bf.toFixed(1)}</td>
                            <td className={`r num ${cls(s.id, 'supportability', 'security', 'scalability', 'documentation', 'eolRisk') ?? ''}`}>{tf.toFixed(1)}</td>
                            <td className={`r num ${cls(s.id, 'platformEolYear') ?? ''}`}>{s.platformEolYear ?? '—'}</td>
                            <td className={`r num ${cls(s.id, 'totalCost') ?? ''}`}>{nokM(cost, 2)}</td>
                            <td className={cls(s.id, 'sizeClass')}>{s.sizeClass}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="note">
                  <span className="assumed-key">Italic</span> values are assumed or derived rather than read from the file. Each system's detail
                  panel lists them under “Data import” in the rule trace.
                </p>
              </>
            )}
          </section>

          <section className="panel confirm-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={errors.length > 0 || !preview || preview.portfolio.systems.length === 0}
              onClick={() => onImport({ fileName: draft.fileName, text: draft.text, mapping })}
            >
              Confirm mapping and run the engine
            </button>
            <span className="muted small">
              {errors.length
                ? `Fix ${errors.length} mapping error${errors.length > 1 ? 's' : ''} first.`
                : 'TIME, 6R, cost and roadmap are recomputed; every tab then shows this inventory.'}
            </span>
          </section>
        </>
      )}
    </div>
  );
}
