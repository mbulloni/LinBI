// Tema dell'interfaccia (chiaro / scuro / come il sistema): `data-theme` on <html> switches the CSS variables
// of styles.css; the report canvas keeps the report theme. The window background follows to avoid flashes.
import { useSyncExternalStore } from 'react';
import { globalOptions, setGlobalOptions, type GlobalOptions } from './options';

export type AppThemePref = NonNullable<GlobalOptions['appTheme']>;
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

export const appThemePref = (): AppThemePref => globalOptions().appTheme ?? 'light';
export const resolvedTheme = (): 'light' | 'dark' => {
  const p = appThemePref();
  return p === 'system' ? (media?.matches ? 'dark' : 'light') : p;
};

function apply() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  (window as any).api?.win?.setTheme?.(t);
  listeners.forEach((l) => l());
}

export function setAppTheme(pref: AppThemePref) {
  setGlobalOptions({ appTheme: pref });
  apply();
}

export function initAppTheme() {
  apply();
  media?.addEventListener('change', () => { if (appThemePref() === 'system') apply(); });
}

/** Current preference, re-rendering when it changes. */
export function useAppTheme(): AppThemePref {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, appThemePref);
}
