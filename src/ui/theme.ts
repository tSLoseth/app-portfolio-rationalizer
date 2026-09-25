import { useEffect, useState } from 'react';
import type { TimeCategory } from '../model/types';

export type ThemeName = 'light' | 'dark';

export interface ChartPalette {
  isDark: boolean;
  time: Record<TimeCategory, string>;
  accent: string;
  accentSoft: string;
  add: string;
  total: string;
  muted: string;
  grid: string;
  axis: string;
  ink: string;
  ink2: string;
  surface: string;
  heat: string[];
}

// TIME hues validated with the dataviz validator (all-pairs, both modes); tolerate is the neutral "no action" grey.
const LIGHT: ChartPalette = {
  isDark: false,
  time: { invest: '#1baf7a', migrate: '#2a78d6', tolerate: '#98a0a8', eliminate: '#eb6834' },
  accent: '#2a78d6',
  accentSoft: '#b7d3f6',
  add: '#eb6834',
  total: '#5d6771',
  muted: '#c3c8ce',
  grid: '#e3e6e9',
  axis: '#c3c8ce',
  ink: '#161a1f',
  ink2: '#59626c',
  surface: '#ffffff',
  heat: ['#f3f5f7', '#e6eef9', '#d3e3f8', '#bdd5f5', '#a3c5f1', '#86b3ec'],
};

const DARK: ChartPalette = {
  isDark: true,
  time: { invest: '#199e70', migrate: '#3987e5', tolerate: '#6f7780', eliminate: '#d95926' },
  accent: '#3987e5',
  accentSoft: '#1c3d66',
  add: '#d95926',
  total: '#8c96a1',
  muted: '#48505a',
  grid: '#2a3037',
  axis: '#3a414a',
  ink: '#eceff2',
  ink2: '#a9b1ba',
  surface: '#1a1e23',
  heat: ['#20252b', '#1b2b3f', '#1d3450', '#1f3d62', '#224775', '#26528a'],
};

const STORAGE_KEY = 'apr-theme';

function stored(): ThemeName | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

export function useTheme() {
  const [explicit, setExplicit] = useState<ThemeName | null>(stored);
  const [osDark, setOsDark] = useState(systemDark);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setOsDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const theme: ThemeName = explicit ?? (osDark ? 'dark' : 'light');

  useEffect(() => {
    const root = document.documentElement;
    if (explicit) root.dataset.theme = explicit;
    else delete root.dataset.theme;
  }, [explicit]);

  const toggle = () => {
    const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
    setExplicit(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  };

  return { theme, palette: theme === 'dark' ? DARK : LIGHT, toggle };
}
