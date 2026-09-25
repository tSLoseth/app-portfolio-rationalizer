import { describe, expect, it } from 'vitest';
import { assumptions as a, portfolio } from '../model/data';
import { allHealth, allScores, makeSystem } from './fixtures';
import { assessTime, assessTimeAll, businessValue, primariesByGroup, technicalHealth } from './time';
import type { System } from '../model/types';

const time = (s: System, all: System[] = [s]) => assessTime(s, a, primariesByGroup(all));

describe('TIME scores', () => {
  it('computes weighted business value including criticality', () => {
    const s = makeSystem({ businessFit: { functionalCoverage: 4, userSatisfaction: 2, strategicRelevance: 5 }, businessCriticality: 1 });
    expect(businessValue(s, a)).toBeCloseTo(0.25 * 4 + 0.15 * 2 + 0.3 * 5 + 0.3 * 1);
  });

  it('subtracts the EOL penalty from weighted technical fit', () => {
    const base = makeSystem({ ...allHealth(4) });
    expect(technicalHealth(base, a)).toBeCloseTo(4);
    expect(technicalHealth({ ...base, platformEolYear: 2020 }, a)).toBeCloseTo(3.5);
    expect(technicalHealth({ ...base, platformEolYear: 2027 }, a)).toBeCloseTo(3.75);
    expect(technicalHealth({ ...base, platformEolYear: 2028 }, a)).toBeCloseTo(4);
  });
});

describe('TIME quadrants', () => {
  it.each([
    [4, 4, 'invest'],
    [4, 2, 'migrate'],
    [2, 4, 'tolerate'],
    [2, 2, 'eliminate'],
  ] as const)('value %i / health %i → %s', (v, h, expected) => {
    const r = time(makeSystem({ ...allScores(v), ...allHealth(h) }));
    expect(r.quadrant).toBe(expected);
    expect(r.category).toBe(expected);
    expect(r.overridesApplied).toEqual([]);
    expect(r.rationale.join(' ')).toContain(`quadrant: ${expected}`);
  });

  it('treats values exactly at the thresholds as high (inclusive)', () => {
    const r = time(makeSystem({ ...allScores(3), ...allHealth(3) }));
    expect(r.businessValue).toBeCloseTo(3);
    expect(r.technicalHealth).toBeCloseTo(3);
    expect(r.category).toBe('invest');
  });

  it('drops to low just below the thresholds', () => {
    const lowValue = time(makeSystem({ ...allScores(3), businessFit: { functionalCoverage: 3, userSatisfaction: 2, strategicRelevance: 3 } }));
    expect(lowValue.businessValue).toBeCloseTo(2.85);
    expect(lowValue.category).toBe('tolerate');
    // EOL within window pushes health from 3.0 to 2.75.
    const lowHealth = time(makeSystem({ ...allScores(3), ...allHealth(3), platformEolYear: 2027, businessCriticality: 3 }));
    expect(lowHealth.technicalHealth).toBeCloseTo(2.75);
    expect(lowHealth.quadrant).toBe('migrate');
  });
});

describe('TIME overrides', () => {
  const primary = makeSystem({ id: 'P', name: 'Primary ERP', duplicateGroup: 'dup-x', isPrimary: true, ...allScores(4), ...allHealth(4) });

  it('(a) forces non-primary duplicates to eliminate with a consolidation target', () => {
    const dup = makeSystem({ id: 'D', duplicateGroup: 'dup-x', isPrimary: false, ...allScores(4), ...allHealth(4) });
    const r = time(dup, [primary, dup]);
    expect(r.quadrant).toBe('invest');
    expect(r.category).toBe('eliminate');
    expect(r.overridesApplied).toEqual(['non_primary_duplicate']);
    expect(r.consolidateInto).toBe('P');
    expect(r.rationale.join(' ')).toContain('consolidate into Primary ERP');
  });

  it('never applies (a) to the primary itself', () => {
    const r = time(primary, [primary]);
    expect(r.category).toBe('invest');
    expect(r.consolidateInto).toBeUndefined();
  });

  it('(b) lifts critical systems with imminent EOL to at least migrate', () => {
    const s = makeSystem({ ...allScores(2), businessCriticality: 4, ...allHealth(2), platformEolYear: 2027 });
    const r = time(s);
    expect(r.quadrant).toBe('eliminate');
    expect(r.category).toBe('migrate');
    expect(r.overridesApplied).toEqual(['eol_critical']);
  });

  it('(b) also covers already-expired platforms and lifts tolerate', () => {
    const s = makeSystem({ ...allScores(2), businessCriticality: 5, ...allHealth(5), platformEolYear: 2019 });
    const r = time(s);
    expect(r.quadrant).toBe('tolerate');
    expect(r.category).toBe('migrate');
  });

  it('(b) respects its boundaries: EOL exactly 2 years away or criticality 3 do not trigger', () => {
    const twoYears = makeSystem({ ...allScores(2), businessCriticality: 5, ...allHealth(2), platformEolYear: 2028 });
    expect(time(twoYears).category).toBe('eliminate');
    const crit3 = makeSystem({ ...allScores(2), businessCriticality: 3, ...allHealth(2), platformEolYear: 2027 });
    expect(time(crit3).category).toBe('eliminate');
  });

  it('(a) wins over (b): critical duplicate with imminent EOL is consolidated and flagged', () => {
    const dup = makeSystem({ id: 'D', duplicateGroup: 'dup-x', isPrimary: false, ...allScores(4), businessCriticality: 5, ...allHealth(2), platformEolYear: 2023 });
    const r = time(dup, [primary, dup]);
    expect(r.quadrant).toBe('migrate');
    expect(r.category).toBe('eliminate');
    expect(r.overridesApplied).toEqual(['non_primary_duplicate']);
    expect(r.flags).toContain('critical_consolidation');
    expect(r.consolidateInto).toBe('P');
    expect(r.rationale.join(' ')).toContain('superseded by consolidation');
  });

  it('flags shadow IT for governance without auto-eliminating it', () => {
    const s = makeSystem({ origin: 'shadow_it', ...allScores(4), ...allHealth(4) });
    const r = time(s);
    expect(r.category).toBe('invest');
    expect(r.flags).toContain('shadow_it_governance');
  });
});

describe('TIME on the real portfolio', () => {
  const results = assessTimeAll(portfolio.systems, a);
  const byId = new Map(portfolio.systems.map((s) => [s.id, s]));
  const nameOf = (id: string) => byId.get(id)!.name;

  it('has a plausible distribution: no category at 0 % or above 60 %', () => {
    for (const c of ['tolerate', 'invest', 'migrate', 'eliminate'] as const) {
      const share = results.filter((r) => r.category === c).length / results.length;
      expect(share, c).toBeGreaterThan(0.05);
      expect(share, c).toBeLessThanOrEqual(0.6);
    }
  });

  it('consolidates BizTalk and Dynamics NAV into their primaries despite critical EOL', () => {
    const biztalk = results.find((r) => nameOf(r.systemId).startsWith('Microsoft BizTalk'))!;
    const nav = results.find((r) => nameOf(r.systemId).startsWith('Microsoft Dynamics NAV'))!;
    for (const r of [biztalk, nav]) {
      expect(r.category).toBe('eliminate');
      expect(r.flags).toContain('critical_consolidation');
    }
    expect(nameOf(biztalk.consolidateInto!)).toContain('Azure Integration Services');
    expect(nameOf(nav.consolidateInto!)).toContain('SAP ECC');
  });

  it('gives every result an auditable rationale', () => {
    for (const r of results) expect(r.rationale.length).toBeGreaterThanOrEqual(3);
  });
});
