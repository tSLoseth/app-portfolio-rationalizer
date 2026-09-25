import type { Hosting, Origin, SixR, TimeCategory } from '../model/types';

export function nokM(x: number, digits = 1): string {
  const abs = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}NOK ${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}NOK ${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}NOK ${Math.round(abs / 1e3)}k`;
  return `${sign}NOK ${Math.round(abs)}`;
}

/** Axis ticks: millions without the currency prefix. */
export const mTick = (x: number) => `${Math.round(x / 1e6)}M`;

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const num = (x: number) => Math.round(x).toLocaleString('en-US');

export const TIME_ORDER: TimeCategory[] = ['invest', 'migrate', 'tolerate', 'eliminate'];
export const SIXR_ORDER: SixR[] = ['retire', 'rehost', 'replatform', 'refactor', 'repurchase', 'retain'];

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const ORIGIN_LABEL: Record<Origin, string> = {
  core: 'Nordlys core',
  acquired_A: 'Vestfjord Maskin (acq. 2022)',
  acquired_B: 'Polarkomponent (acq. 2024)',
  shadow_it: 'Shadow IT',
};

export const HOSTING_LABEL: Record<Hosting, string> = {
  on_prem_dc: 'On-prem data center',
  private_cloud: 'Private cloud',
  saas: 'SaaS',
  public_cloud: 'Public cloud',
};
