/** Pure navigation rules for the hire form's folder picker. Kept separate
 *  from FolderPicker.tsx (the fetch + rendering layer) so drill-down/up/select
 *  can be unit tested without a network layer or a DOM. */

/** One subdirectory returned by GET /api/list-dir. */
export interface DirEntry {
  name: string;
  path: string;
}

/** A directory listing as returned by GET /api/list-dir. */
export interface DirListing {
  path: string;
  parent: string | null;
  entries: DirEntry[];
  error: boolean;
}

export type FolderPickerAction = { type: 'drillDown'; entry: DirEntry } | { type: 'goToParent' };

/** The path to request next for a drill-down or "go up" action, or null if
 *  the action isn't currently available (e.g. "go up" while already at the
 *  top, or with no listing loaded yet). */
export function nextRequestPath(
  listing: DirListing | null,
  action: FolderPickerAction,
): string | null {
  if (action.type === 'drillDown') return action.entry.path;
  if (!listing || listing.parent === null) return null;
  return listing.parent;
}

/** The absolute path to fill into the cwd field when "이 폴더 선택" is
 *  clicked, or null when there's nothing valid to confirm: no listing yet,
 *  the current path failed to load, or it's the '' starting screen (the
 *  drive list / a placeholder, not an actual folder). */
export function confirmedCwd(listing: DirListing | null): string | null {
  if (!listing || listing.error || listing.path === '') return null;
  return listing.path;
}
