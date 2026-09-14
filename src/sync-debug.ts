/** Temporary local incident tracing. No photos, field values, cookies or tokens. */
export const RECOVERY_BUILD = '2026-09-14 photo rescue 2';
const KEY = 'vs.sync-debug';
export function trace(message: string): void {
  try {
    const rows = readTrace(); rows.push(`${new Date().toISOString()} ${message.slice(0, 500)}`);
    localStorage.setItem(KEY, JSON.stringify(rows.slice(-150)));
  } catch { /* Diagnostics must never prevent saving or uploading. */ }
}
export function readTrace(): string[] {
  try { const rows: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(rows) ? rows.filter((x): x is string => typeof x === 'string').slice(-150) : [];
  } catch { return []; }
}
