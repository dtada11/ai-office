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

/** One clickable crumb in the breadcrumb trail. `path` is the absolute path
 *  to request when it's clicked; `label` is what to display for it. */
export interface PathSegment {
  label: string;
  path: string;
}

/** Breaks an absolute path into breadcrumb segments, root-to-leaf, so each
 *  ancestor can be a clickable "jump here". Handles both Windows drive paths
 *  ("C:\\Users\\me") and POSIX paths ("/home/me") -- the server can run on
 *  either OS, and this file has no access to Node's `path` module (it runs
 *  in the browser), so splitting is done by hand from whichever separator
 *  the string actually contains. Returns [] for the '' starting screen
 *  (drive list -- not a real path to break down). */
export function pathSegments(fullPath: string): PathSegment[] {
  if (!fullPath) return [];

  const driveMatch = /^([A-Za-z]:)[\\/]/.exec(fullPath);
  if (driveMatch) {
    const sep = fullPath.includes('\\') ? '\\' : '/';
    const root = driveMatch[1] + sep;
    const rest = fullPath.slice(root.length).split(/[\\/]/).filter(Boolean);
    const segments: PathSegment[] = [{ label: root, path: root }];
    let acc = root;
    for (const part of rest) {
      acc = acc.endsWith(sep) ? acc + part : acc + sep + part;
      segments.push({ label: part, path: acc });
    }
    return segments;
  }

  // POSIX absolute path.
  const parts = fullPath.split('/').filter(Boolean);
  const segments: PathSegment[] = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    segments.push({ label: part, path: acc });
  }
  return segments;
}

/** A collapsed-out stretch of the breadcrumb, rendered as a plain "…". */
export interface BreadcrumbEllipsis {
  ellipsis: true;
}

/** Keeps the root segment and the last `tailCount` segments, replacing
 *  whatever's cut from the middle with a single ellipsis marker. A deep path
 *  then still shows "where the drive/root is" and "where you are now"
 *  without an unbounded row of clickable crumbs. No-op when there's nothing
 *  to cut. */
export function collapseBreadcrumb(
  segments: PathSegment[],
  tailCount = 2,
): (PathSegment | BreadcrumbEllipsis)[] {
  if (segments.length <= tailCount + 1) return segments;
  return [segments[0], { ellipsis: true }, ...segments.slice(segments.length - tailCount)];
}
