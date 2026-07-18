/** Pure helpers behind the board window: turning BOARD.md text into entries a
 *  view can style, and working out which team's board to show.
 *
 *  Kept free of React and the DOM so both are decidable in a plain Node test —
 *  the same reason chatWindowPosition.ts exists next door.
 */

/** One line of the board, as appendBoard (server/src/employees.ts) writes it:
 *
 *      - `12시 20분 33초` **[배분]** 팀장 → 개발 / 개발자: …
 */
export interface BoardEntry {
  /** Clock time the server rendered. '' when the line carried none. */
  time: string;
  /** 배분 | 수거 | 메모 as written. '' for a line that is not an entry. */
  kind: string;
  /** Everything after the kind tag. The whole line, when kind is ''. */
  text: string;
}

/** Anchored on the exact shape appendBoard writes, but tolerant about spacing.
 *  `kind` is captured, not enumerated: the server owns that vocabulary and can
 *  add to it, and an unknown kind should still render as an entry rather than
 *  silently vanish from the board. */
const ENTRY_LINE = /^-\s+`([^`]*)`\s+\*\*\[([^\]]*)\]\*\*\s*([\s\S]*)$/;

/** One line → an entry, or null when the line is not an entry at all (the
 *  file's `#` title and `>` blurb, and blank lines). */
export function parseBoardEntry(line: string): BoardEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = ENTRY_LINE.exec(trimmed);
  if (match) return { time: match[1], kind: match[2], text: match[3].trim() };

  // Not an entry: the header, the blurb, or anything else at the top of the
  // file. Those are boilerplate the reader does not need repeated.
  if (trimmed.startsWith('#') || trimmed.startsWith('>')) return null;

  // A line that is neither boilerplate nor a well-formed entry still gets
  // shown, unstyled. Dropping it would quietly hide content that is genuinely
  // in the user's file, and this view's whole job is to show that file.
  return { time: '', kind: '', text: trimmed };
}

/** The whole file → entries, oldest first (the order they were appended).
 *
 *  One line is one entry: every appendBoard call site runs its text through
 *  oneLine(), which collapses \s+ to spaces, so an entry cannot span lines and
 *  there is no continuation case to stitch back together here. */
export function parseBoard(markdown: string): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const line of markdown.split('\n')) {
    const entry = parseBoardEntry(line);
    if (entry) out.push(entry);
  }
  return out;
}

/** A team the user can look at the board of. */
export interface TeamOption {
  /** The lead whose cwd this is — used as a stable React key. */
  agentId: number;
  /** The lead's name, which is how the user thinks of the team. */
  name: string;
  /** The lead's cwd: the team root, and the value requestBoard takes. */
  root: string;
}

/** Just the roster fields teamOptions reads. Spelled out here rather than
 *  importing EmployeeInfo so this file stays free of the React hook module that
 *  declares it: the test project (tsconfig.node.json) compiles test/ without
 *  src/, so a type import from there pulls a file full of `window` globals into
 *  a program that has no DOM augmentation and fails to build. EmployeeInfo
 *  satisfies this structurally, so callers pass one unchanged. */
export interface TeamMember {
  agentId: number;
  name: string;
  cwd: string;
  role: 'lead' | 'staff';
}

/** Which teams exist, from the roster the client already has — one per lead
 *  with a cwd. Deduplicated by root, because two leads sharing a folder share
 *  one board and would otherwise appear as two identical choices. */
export function teamOptions(employees: TeamMember[]): TeamOption[] {
  const out: TeamOption[] = [];
  for (const e of employees) {
    if (e.role !== 'lead' || !e.cwd) continue;
    if (out.some((t) => t.root === e.cwd)) continue;
    out.push({ agentId: e.agentId, name: e.name, root: e.cwd });
  }
  return out;
}

/** The root actually to show, given what the user picked. Falls back to the
 *  first team when the pick is stale — the lead may have been fired while the
 *  window sat open, and a window stuck on a team that no longer exists would
 *  show an empty state the user cannot get out of. Undefined when there are no
 *  teams at all, which is the honest empty state. */
export function resolveTeamRoot(options: TeamOption[], selected?: string): string | undefined {
  if (selected && options.some((t) => t.root === selected)) return selected;
  return options[0]?.root;
}
