import type { Quarter } from '../model/types';

/** Absolute quarter number (year × 4 + quarter − 1) so quarters can be compared and added. */
export function quarterIndex(q: Quarter): number {
  const m = /^(\d{4})Q([1-4])$/.exec(q);
  if (!m) throw new Error(`Invalid quarter ${q}`);
  return Number(m[1]) * 4 + Number(m[2]) - 1;
}

export function quarterFromIndex(i: number): Quarter {
  return `${Math.floor(i / 4)}Q${((i % 4) + 1) as 1 | 2 | 3 | 4}`;
}

export const addQuarters = (q: Quarter, n: number): Quarter => quarterFromIndex(quarterIndex(q) + n);
