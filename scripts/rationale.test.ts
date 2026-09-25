import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assessPortfolio } from '../src/engine/assess';
import { assumptions, portfolio } from '../src/model/data';
import type { SixR, TimeCategory } from '../src/model/types';
import { checkRationale } from './rationale-terms';

const path = resolve(dirname(fileURLToPath(import.meta.url)), '../data/rationale.json');
type Entry = { text: string; model: string; time: TimeCategory; sixR: SixR; generatedAt: string };

describe('checkRationale', () => {
  it('accepts synonyms and rejects a missing decision', () => {
    expect(checkRationale('An Eliminate case: the tool is retired.', 'eliminate', 'retire')).toEqual([]);
    expect(checkRationale('Classed as Migrate; it will be replaced with SaaS.', 'migrate', 'repurchase')).toEqual([]);
    expect(checkRationale('Classed as Migrate and rehosted.', 'migrate', 'refactor')).toHaveLength(1);
  });
});

describe.skipIf(!existsSync(path))('AI rationale texts (data/rationale.json)', () => {
  const texts = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, Entry>) : {};
  const { assessments } = assessPortfolio(portfolio, assumptions);

  it('has exactly one entry per system', () => {
    expect(Object.keys(texts).sort()).toEqual(assessments.map((x) => x.system.id).sort());
  });

  it('matches the current engine decisions (catches stale texts)', () => {
    for (const x of assessments) {
      expect(texts[x.system.id]?.time, x.system.id).toBe(x.time.category);
      expect(texts[x.system.id]?.sixR, x.system.id).toBe(x.sixR.sixR);
    }
  });

  it('names the TIME category and 6R strategy in every text', () => {
    for (const x of assessments) {
      const e = texts[x.system.id]!;
      expect(checkRationale(e.text, x.time.category, x.sixR.sixR), `${x.system.id}: ${e.text}`).toEqual([]);
    }
  });

  it('keeps texts short (2–3 sentences)', () => {
    for (const [id, e] of Object.entries(texts)) {
      expect(e.text.split(/\s+/).length, id).toBeLessThanOrEqual(110);
      expect(e.model, id).toMatch(/^claude-haiku/);
    }
  });
});
