import { I18nService } from 'nestjs-i18n';

/**
 * The note attached to an audit log entry.
 *
 * A plain string is text a user typed — it stays in whatever language they
 * wrote it in and is stored and returned verbatim. The object form is a
 * system-generated sentence, stored as an i18n key so it can be rendered in
 * the *reader's* language rather than frozen in the writer's.
 *
 * `args` values may themselves be notes, which is how a composed sentence
 * (a user's note plus a system suffix, a status code inside a phrase) stays
 * translatable end to end.
 */
export type AuditNote = string | { key: string; args?: Record<string, unknown> };

type KeyedNote = Exclude<AuditNote, string>;

// Namespaced upper-case key, e.g. `audit-logs.NOTE_ORDER_RECEIVED`. This is
// the guard that keeps a user-typed note which happens to be valid JSON from
// being mistaken for a translation key.
const KEY_PATTERN = /^[\w-]+\.[A-Z][\w.]*$/;

/** Collapses a note down to the single TEXT column `audit_logs.notes` still is. */
export function serializeAuditNote(note?: AuditNote | null): string | undefined {
  if (note === undefined || note === null) return undefined;
  return typeof note === 'string' ? note : JSON.stringify(note);
}

/**
 * Renders a stored note in `lang`.
 *
 * Anything that is not a serialized key comes back exactly as stored — that
 * covers both user-typed text and every row written before notes were keyed,
 * which is why this needed no migration and no backfill.
 */
export function renderAuditNote(
  stored: string | null,
  i18n: I18nService,
  lang: string,
): string | null {
  const note = parseNote(stored);
  return note ? render(note, i18n, lang).trim() : stored;
}

function parseNote(stored: string | null): KeyedNote | null {
  if (!stored || !stored.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isKeyedNote(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function render(note: KeyedNote, i18n: I18nService, lang: string): string {
  const args = note.args && renderArgs(note.args, i18n, lang);
  return i18n.translate(note.key, { lang, args });
}

function renderArgs(
  args: Record<string, unknown>,
  i18n: I18nService,
  lang: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([name, value]) => [
      name,
      isKeyedNote(value) ? render(value, i18n, lang) : value,
    ]),
  );
}

function isKeyedNote(value: unknown): value is KeyedNote {
  if (typeof value !== 'object' || value === null) return false;
  const key = (value as { key?: unknown }).key;
  return typeof key === 'string' && KEY_PATTERN.test(key);
}
