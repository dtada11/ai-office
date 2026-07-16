/**
 * Pure display helpers for the settings panel's "자동 허용" section.
 *
 * Kept apart from the component so they can be tested without a DOM. Named
 * `allowlistFormat` rather than `allowlistSection`: a module name differing from
 * AllowlistSection.tsx only by case resolves to whichever of the two Windows
 * hands back, and the import lands on the wrong module with no error.
 */

/** What a match type means, in the terms the user chose it in. */
export function matchLabel(match: 'exact' | 'dirPrefix'): string {
  return match === 'dirPrefix' ? '하위 전체' : '정확히 이 명령';
}

/**
 * "언제 허용했나", to the minute — the date alone can't separate two grants on
 * the same day, which is exactly when the user is trying to remember what they
 * clicked.
 *
 * Local time, from the Date getters rather than Intl: this is the user's own
 * clock, and toLocaleString's output shifts with the host locale, which would
 * make the format untestable and the panel inconsistent between machines.
 *
 * Returns '' for a timestamp that won't parse, so a corrupted file costs the
 * user a line of text instead of an "Invalid Date" in the panel.
 */
export function formatAddedAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${at.getMonth() + 1}월${at.getDate()}일 ${hh}:${mm}`;
}

/** The second line under an entry: what the match means, and when it was granted. */
export function entryDetail(match: 'exact' | 'dirPrefix', addedAt: string): string {
  const when = formatAddedAt(addedAt);
  return when ? `${matchLabel(match)} · ${when}` : matchLabel(match);
}
