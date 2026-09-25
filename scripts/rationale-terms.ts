import type { SixR, TimeCategory } from '../src/model/types';

// Accepted wordings per decision, so a text can say "retirement" or "replace it with SaaS".
export const TIME_TERMS: Record<TimeCategory, RegExp> = {
  tolerate: /\btolerat/i,
  invest: /\binvest/i,
  migrate: /\bmigrat/i,
  eliminate: /\beliminat/i,
};

export const SIX_R_TERMS: Record<SixR, RegExp> = {
  rehost: /\bre-?host|lift[- ]and[- ]shift/i,
  replatform: /\bre-?platform/i,
  refactor: /\bre-?factor|re-?architect/i,
  repurchase: /\bre-?purchas|replace[sd]? (it )?with (a )?SaaS|SaaS replacement/i,
  retire: /\bretir|decommission|switch(ed)?[- ]off/i,
  retain: /\bretain|\bkeep\b|\bkept\b/i,
};

/** Problems with a generated text; empty when it names both decisions. */
export function checkRationale(text: string, time: TimeCategory, sixR: SixR): string[] {
  const problems: string[] = [];
  if (!TIME_TERMS[time].test(text)) problems.push(`does not mention TIME category "${time}"`);
  if (!SIX_R_TERMS[sixR].test(text)) problems.push(`does not mention 6R strategy "${sixR}"`);
  return problems;
}

/** Factual slips the prompt forbids: engine-internal track numbers, and cost-case language on a Retain. */
export function checkFactualSlips(text: string, sixR: SixR): string[] {
  const problems: string[] = [];
  if (/\bwaves?\b|\btrack \d/i.test(text)) problems.push('mentions a wave or track number; use quarters or the calendar horizon');
  if (sixR === 'retain' && /investment is justified|justified by|pays back|simple payback|payback of|one-off|migration cost/i.test(text)) {
    problems.push('describes a cost case (investment, payback, justification) for a Retain decision');
  }
  return problems;
}
