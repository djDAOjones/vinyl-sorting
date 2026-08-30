import type { Env } from './env.ts';

/**
 * Writing a capture. `capture` holds what a HUMAN read off the disc and
 * is never machine-written (AGENTS.md, project boundaries), so this is
 * the only path that writes it, and nothing here consults Discogs.
 */

/** Goldmine grades, the only values `item` accepts. */
const GRADES = ['M', 'NM', 'VG+', 'VG', 'G', 'P'] as const;
// `other` means "a photograph of this item, not described" — what the
// app stores, because it does not ask which photo is which and would
// otherwise be inventing the answer. The five specific kinds stay for
// anything that can honestly claim one.
const PHOTO_KINDS = ['label_a', 'label_b', 'front', 'back', 'runout', 'other'] as const;

export type Grade = (typeof GRADES)[number];
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export interface CaptureInput {
  /** Client-generated, so a retry of a queued entry cannot double-write. */
  clientId: string;
  crate: string | null;
  position?: string;
  catnoRaw?: string;
  labelRaw?: string;
  nameRaw?: string;
  titleRaw?: string;
  matrixRunout?: string;
  yearRaw?: string;
  mediaGrade?: Grade;
  sleeveGrade?: Grade;
  capturedBy?: string;
  notes?: string;
  photos?: { kind: PhotoKind; r2Key: string }[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const trimmed = (v: unknown): string | undefined => {
  if (!isStr(v)) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
};

/**
 * Validate a queued entry. Deliberately permissive: photo-first capture
 * means walking a crate photographing labels and typing nothing, so a
 * capture with only a photo is valid and common.
 *
 * CRATE IS NOT REQUIRED (maintainer, 2026-08-30). It was, on the
 * reasoning that a session card has to say where to find the disc. That
 * assumed the storage is stable, and it is not — so the field was being
 * filled with placeholders, and item 448 arrived as crate "1",
 * position "1". A required field answered with filler is worse than an
 * absent one: the database then asserts a location that is untrue, and
 * nothing downstream can tell it from a real one. Same rule as
 * everywhere else here — refuse rather than guess.
 */
export function parseCapture(body: unknown): { ok: true; value: CaptureInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;

  const clientId = trimmed(b.clientId);
  if (!clientId) return { ok: false, error: 'clientId is required so a retried queue entry cannot double-write' };

  const crate = trimmed(b.crate);

  const photos: { kind: PhotoKind; r2Key: string }[] = [];
  if (b.photos !== undefined) {
    if (!Array.isArray(b.photos)) return { ok: false, error: 'photos must be an array' };
    for (const p of b.photos) {
      const kind = (p as Record<string, unknown>)?.kind;
      const r2Key = trimmed((p as Record<string, unknown>)?.r2Key);
      if (!isStr(kind) || !(PHOTO_KINDS as readonly string[]).includes(kind)) {
        return { ok: false, error: `photo kind must be one of ${PHOTO_KINDS.join(', ')}` };
      }
      if (!r2Key) return { ok: false, error: 'each photo needs an r2Key' };
      photos.push({ kind: kind as PhotoKind, r2Key });
    }
  }

  const catnoRaw = trimmed(b.catnoRaw);
  if (photos.length === 0 && !catnoRaw) {
    return { ok: false, error: 'a capture needs at least a photo or a catalogue number' };
  }

  for (const g of ['mediaGrade', 'sleeveGrade'] as const) {
    const v = trimmed(b[g]);
    if (v !== undefined && !(GRADES as readonly string[]).includes(v)) {
      return { ok: false, error: `${g} must be a Goldmine grade: ${GRADES.join(', ')}` };
    }
  }

  return {
    ok: true,
    value: {
      clientId, crate: crate || null, catnoRaw, photos,
      position: trimmed(b.position),
      labelRaw: trimmed(b.labelRaw),
      nameRaw: trimmed(b.nameRaw),
      titleRaw: trimmed(b.titleRaw),
      matrixRunout: trimmed(b.matrixRunout),
      yearRaw: trimmed(b.yearRaw),
      mediaGrade: trimmed(b.mediaGrade) as Grade | undefined,
      sleeveGrade: trimmed(b.sleeveGrade) as Grade | undefined,
      capturedBy: trimmed(b.capturedBy),
      notes: trimmed(b.notes),
    },
  };
}

/**
 * Insert one capture. Idempotent on `clientId`: the offline queue
 * retries, and a retry must not create a second disc.
 *
 * Every value written gets a `field_source` row with source `shelf` —
 * a person read it off the record — and NO confirmation. Reading a
 * label is not the same as verifying a pressing, so these stay
 * decision-ineligible until M2 corroborates them.
 */
export async function insertCapture(env: Env, input: CaptureInput): Promise<{ itemId: number; created: boolean }> {
  const existing = await env.DB.prepare('SELECT id FROM item WHERE import_ref = ?')
    .bind(`capture:${input.clientId}`).first<{ id: number }>();
  if (existing) return { itemId: existing.id, created: false };

  const item = await env.DB.prepare(
    `INSERT INTO item (crate, position, media_grade, sleeve_grade, captured_by, captured_at, notes, import_ref)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?) RETURNING id`,
  ).bind(
    input.crate ?? null, input.position ?? null, input.mediaGrade ?? null, input.sleeveGrade ?? null,
    input.capturedBy ?? null, input.notes ?? null, `capture:${input.clientId}`,
  ).first<{ id: number }>();
  if (!item) throw new Error('item insert returned no id');
  const itemId = item.id;

  const capture = await env.DB.prepare(
    `INSERT INTO capture (item_id, catno_raw, label_raw, name_raw, title_raw, matrix_runout, year_raw)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    itemId, input.catnoRaw ?? null, input.labelRaw ?? null, input.nameRaw ?? null,
    input.titleRaw ?? null, input.matrixRunout ?? null, input.yearRaw ?? null,
  ).first<{ id: number }>();
  if (!capture) throw new Error('capture insert returned no id');

  const sourced: [string, number, string][] = [];
  const captureFields: [keyof CaptureInput, string][] = [
    ['catnoRaw', 'catno_raw'], ['labelRaw', 'label_raw'], ['nameRaw', 'name_raw'],
    ['titleRaw', 'title_raw'], ['matrixRunout', 'matrix_runout'], ['yearRaw', 'year_raw'],
  ];
  for (const [key, column] of captureFields) {
    if (input[key] !== undefined) sourced.push(['capture', capture.id, column]);
  }
  for (const [key, column] of [['crate', 'crate'], ['position', 'position'],
    ['mediaGrade', 'media_grade'], ['sleeveGrade', 'sleeve_grade']] as [keyof CaptureInput, string][]) {
    if (input[key] !== undefined) sourced.push(['item', itemId, column]);
  }

  const statements = [
    ...sourced.map(([entity, id, field]) => env.DB
      .prepare("INSERT INTO field_source (entity, entity_id, field, source) VALUES (?, ?, ?, 'shelf')")
      .bind(entity, id, field)),
    ...(input.photos ?? []).map((p) => env.DB
      .prepare('INSERT INTO item_photo (item_id, kind, r2_key) VALUES (?, ?, ?)')
      .bind(itemId, p.kind, p.r2Key)),
  ];
  if (statements.length) await env.DB.batch(statements);

  return { itemId, created: true };
}
