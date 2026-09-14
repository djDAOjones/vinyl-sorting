import type { Env } from '../env.ts';
import type { MatchRow } from './run.ts';

// A single input definition for scheduling, retries and the preparation panel.
// Release metadata is never evidence for its own match.
const raw = (field: string) => `(SELECT r.value FROM raw_value r
  WHERE r.item_id = i.id AND r.field = '${field}' ORDER BY r.id DESC LIMIT 1)`;
const value = (field: string) => `COALESCE(NULLIF(TRIM(c.${field}), ''), ${raw(field)})`;
export const MATCH_COLUMNS = `i.id AS itemId, c.id AS captureId,
  ${value('catno_raw')} AS catnoRaw, ${value('label_raw')} AS labelRaw,
  ${value('title_raw')} AS titleRaw, ${value('name_raw')} AS nameRaw,
  ${value('year_raw')} AS yearRaw, ${raw('other_numbers')} AS otherNumbers`;
export const MATCH_FROM = `FROM item i LEFT JOIN capture c ON c.id = (
  SELECT id FROM capture WHERE item_id = i.id ORDER BY captured_at DESC, id DESC LIMIT 1)`;

export async function loadMatchRow(env: Env, id: number): Promise<MatchRow | null> {
  return env.DB.prepare(`SELECT ${MATCH_COLUMNS} ${MATCH_FROM} WHERE i.id = ?`).bind(id).first<MatchRow>();
}
