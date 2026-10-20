// Opzioni › Globale: per-user settings kept in the renderer's localStorage (not in reports).
export interface GlobalOptions {
  /** Caricamento dati › Rileva automaticamente le nuove relazioni dopo il caricamento dei dati. */
  autoRelationships: boolean;
}

const KEY = 'linbi.options';
const DEFAULTS: GlobalOptions = { autoRelationships: true };

export function globalOptions(): GlobalOptions {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}

export function setGlobalOptions(patch: Partial<GlobalOptions>): GlobalOptions {
  const next = { ...globalOptions(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}
