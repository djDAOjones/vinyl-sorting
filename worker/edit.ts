import type { Env } from './env.ts';

/**
 * Correcting a reading, and confirming one.
 *
 * THIS IS THE ONE PLACE `capture` IS WRITTEN AFTER THE FACT, and it is
 * allowed here for a reason the hard rule always meant. The bar exists
 * so duplicate detection runs on what a person read rather than on what
 * a bad match wrote — a bar on MACHINE writes. A person fixing their own
 * typo is the opposite case. AGENTS.md was reworded to say so on
 * maintainer sign-off, 2026-08-31; machine writes stay barred, and
 * nothing in `match/` or `review.ts` may reach this file.
 *
 * The accepted cost, stated with the decision: the previous reading is
 * gone. For the 446 imported rows it survives in
 * `data/deep-groove-v1.csv`; for app captures it does not.
 *
 * WHAT AN EDIT WRITES: the value, and a `field_source` row with source
 * `shelf`, `confirmed_by` and `confirmed_at` set. `insertCapture`
 * deliberately writes `shelf` UNCONFIRMED — typing at a crate is not
 * verifying a pressing. Deciding at a screen that a value is right is a
 * different act, and it is what `confirmed_by` was added for.
 *
 * It makes nothing decision-eligible. `v_decision_eligible_item` needs
 * a confirmed `release_id` on the ITEM, which only the review queue
 * produces. This improves what the matcher searches with; it is not a
 * verdict about a pressing.
 */

/**
 * The columns an edit may name, per entity.
 *
 * An allow-list rather than an escape, because the field name reaches a
 * column position in the SQL below. Nothing outside these two lists can
 * be written however the request is spelled — and `release_id`,
 * `decision` and every audit column are absent on purpose: those are
 * the review queue's and M5's to write, not this screen's.
 */
export const CAPTURE_FIELDS = [
  'catno_raw', 'label_raw', 'name_raw', 'title_raw', 'year_raw', 'matrix_runout',
] as const;

export const ITEM_FIELDS = ['crate', 'position', 'media_grade', 'sleeve_grade', 'notes'] as const;

const GRADES = ['M', 'NM', 'VG+', 'VG', 'G', 'P'];

export type EditEntity = 'capture' | 'item';

export interface EditInput {
  entity: EditEntity;
  field: string;
  /** Absent means CONFIRM IN PLACE: the value is already right. */
  value?: string | null;
  confirmedBy: string;
}

const fieldsFor = (entity: EditEntity): readonly string[] => (
  entity === 'capture' ? CAPTURE_FIELDS : ITEM_FIELDS);

export function parseEdit(body: unknown): { ok: true; value: EditInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;

  const entity = b.entity;
  if (entity !== 'capture' && entity !== 'item') {
    return { ok: false, error: 'entity must be capture or item' };
  }
  const field = typeof b.field === 'string' ? b.field : '';
  if (!fieldsFor(entity).includes(field)) {
    return { ok: false, error: `field must be one of ${fieldsFor(entity).join(', ')}` };
  }

  // With no sign-in there is no identity to read, so the person names
  // themselves — and the schema refuses a confirmation that does not.
  const confirmedBy = typeof b.confirmedBy === 'string' ? b.confirmedBy.trim() : '';
  if (!confirmedBy) {
    return { ok: false, error: 'confirmedBy is required — a confirmation must say who made it' };
  }

  // `value` absent is confirm-in-place. `value` null or empty is a
  // deliberate erasure, which is a different act and is allowed: a
  // wrong reading removed is better than a wrong reading kept.
  let value: string | null | undefined;
  if ('value' in b) {
    if (b.value === null) value = null;
    else if (typeof b.value === 'string') value = b.value.trim() === '' ? null : b.value.trim();
    else return { ok: false, error: 'value must be a string or null' };

    if ((field === 'media_grade' || field === 'sleeve_grade') && value !== null
      && !GRADES.includes(value)) {
      return { ok: false, error: `${field} must be a Goldmine grade: ${GRADES.join(', ')}` };
    }
  }

  return { ok: true, value: { entity, field, value, confirmedBy } };
}

export interface EditResult { itemId: number; entityId: number; field: string; value: string | null }

/**
 * The capture row an edit writes to, created if the item has none.
 *
 * 446 imported rows have one; a photo-only capture may not, and the
 * label is captured on 0% of the backlog — filling it is most of why
 * this screen exists, so "no row yet" cannot be a refusal.
 */
async function captureRowFor(env: Env, itemId: number): Promise<number> {
  const existing = await env.DB.prepare(
    'SELECT id FROM capture WHERE item_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1',
  ).bind(itemId).first<{ id: number }>();
  if (existing) return existing.id;

  const created = await env.DB.prepare('INSERT INTO capture (item_id) VALUES (?) RETURNING id')
    .bind(itemId).first<{ id: number }>();
  if (!created) throw new Error('capture insert returned no id');
  return created.id;
}

/** Read one allow-listed column. The name is never caller-controlled here. */
async function readField(env: Env, table: EditEntity, id: number, field: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT ${field} AS v FROM ${table} WHERE id = ?`)
    .bind(id).first<{ v: string | null }>();
  return row?.v ?? null;
}

/**
 * Correct a field, or confirm the value already there.
 *
 * Returns null when the item does not exist, so the route can 404
 * rather than silently creating provenance for nothing.
 */
export async function applyEdit(env: Env, itemId: number, input: EditInput): Promise<EditResult | null> {
  const item = await env.DB.prepare('SELECT id FROM item WHERE id = ?').bind(itemId).first<{ id: number }>();
  if (!item) return null;

  const entityId = input.entity === 'capture' ? await captureRowFor(env, itemId) : itemId;

  if (input.value !== undefined) {
    // The field name comes from the allow-list above, never from the
    // request, so it cannot carry SQL. The VALUE is always bound.
    await env.DB.prepare(`UPDATE ${input.entity} SET ${input.field} = ? WHERE id = ?`)
      .bind(input.value, entityId).run();
  }

  // Upsert, in the shape resolveRun already uses: confirming the same
  // field twice re-stamps who and when rather than duplicating, and
  // `UNIQUE (entity, entity_id, field)` is what makes that safe.
  await env.DB.prepare(
    `INSERT INTO field_source (entity, entity_id, field, source, confirmed_by, confirmed_at)
     VALUES (?, ?, ?, 'shelf', ?, datetime('now'))
     ON CONFLICT (entity, entity_id, field)
     DO UPDATE SET source = 'shelf', confirmed_by = excluded.confirmed_by,
                   confirmed_at = excluded.confirmed_at`,
  ).bind(input.entity, entityId, input.field, input.confirmedBy).run();

  return {
    itemId,
    entityId,
    field: input.field,
    value: input.value !== undefined ? input.value : await readField(env, input.entity, entityId, input.field),
  };
}

export interface PromoteInput { field: string; confirmedBy: string }

export function parsePromote(body: unknown): { ok: true; value: PromoteInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const field = typeof b.field === 'string' ? b.field : '';
  if (!(CAPTURE_FIELDS as readonly string[]).includes(field)) {
    return { ok: false, error: `field must be one of ${CAPTURE_FIELDS.join(', ')}` };
  }
  const confirmedBy = typeof b.confirmedBy === 'string' ? b.confirmedBy.trim() : '';
  if (!confirmedBy) {
    return { ok: false, error: 'confirmedBy is required — a confirmation must say who made it' };
  }
  return { ok: true, value: { field, confirmedBy } };
}

/**
 * Promote a reading held in `raw_value` into the capture field it
 * belongs to: one tap saying "yes, that is what the label says".
 *
 * IT WRITES A NEW `shelf` ROW RATHER THAN LAUNDERING THE OLD ONE. The
 * `raw_value` row and its `vision` provenance are left exactly as they
 * were, so what the model read stays on record and stays outside
 * `v_confirmed_field`, which allow-lists ('shelf','discogs',
 * 'musicbrainz'). Re-labelling the reading as confirmed would erase the
 * difference between a machine's answer and a person's — which is the
 * difference this project exists to keep.
 */
export async function promoteReading(
  env: Env, itemId: number, input: PromoteInput,
): Promise<EditResult | null | 'no-reading'> {
  const reading = await env.DB.prepare('SELECT id, value FROM raw_value WHERE item_id = ? AND field = ?')
    .bind(itemId, input.field).first<{ id: number; value: string }>();
  if (!reading) return 'no-reading';

  return applyEdit(env, itemId, {
    entity: 'capture', field: input.field, value: reading.value, confirmedBy: input.confirmedBy,
  });
}

/**
 * The shared passphrase, compared without leaking its length by timing.
 *
 * Not sign-in and it does not pretend to be — OPEN-V1-AUTH decided v1
 * has none. It is a bolt on the one drawer worth bolting: adding a row
 * is not the risk that rewriting 465 is, and the repo is public and
 * names the live URL, so this door is a real one.
 */
export function tokenMatches(expected: string | undefined, given: string | null): boolean {
  if (!expected || !given) return false;
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
