/**
 * Tiny tagged logger shared by both apps. Every line is prefixed with a scope
 * tag (e.g. "[env]", "[discovery]", "[spotify]") so the Metro console is easy
 * to scan and grep while debugging on-device.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, msg: string, data?: unknown): void {
  const line = `[${scope}] ${msg}`;
  const fn =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (data !== undefined) fn(line, data);
  else fn(line);
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

/** Create a logger bound to a scope tag. */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, d) => emit('debug', scope, m, d),
    info: (m, d) => emit('info', scope, m, d),
    warn: (m, d) => emit('warn', scope, m, d),
    error: (m, d) => emit('error', scope, m, d),
  };
}

/**
 * Mask a secret for logging — reveals only its length and last 4 chars, so we
 * can confirm a value is present/correct without leaking it into logs.
 */
export function maskSecret(v: string | undefined | null): string {
  if (!v) return '<empty>';
  if (v.length <= 4) return `<len:${v.length}>`;
  return `<len:${v.length} …${v.slice(-4)}>`;
}
