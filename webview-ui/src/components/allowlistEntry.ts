/** Turning a permission card into an allowlist entry — the "다음부터 묻지 않기" path.
 *
 *  Split out of EmployeeChat so it can be tested. Both halves silently produced
 *  nothing when they were inline: the input arrives as a JSON string and was
 *  being dropped, and a file path was being stored where a folder belongs.
 *  Neither shows up in a type error or a render — only in the button quietly
 *  approving and saving nothing.
 */

export interface AllowlistEntry {
  match: 'exact' | 'dirPrefix';
  value: string;
}

/** A tool call's arguments. The wire carries them as a JSON string. Returns {}
 *  on anything unparseable, so a malformed payload means "no allowlist entry"
 *  rather than a throw inside a click handler. */
export function parseToolInput(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

/** Parent folder of a path. Handles both separators: the path comes from the
 *  employee's own tool call, and this office runs on Windows and in a Linux
 *  container. The server normalizes before it stores or compares. */
export function dirOf(p: string): string {
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return cut > 0 ? p.slice(0, cut) : p;
}

/** What this tool call should become in the allowlist, or null for "no entry".
 *
 *  Bash is exact — a prefix would let `npm run test; rm -rf /` through on the
 *  strength of an approved `npm run test`. Read/Grep/Glob take the folder, since
 *  a file path under dirPrefix only ever matches itself and the next file in the
 *  same folder would ask all over again — the friction this button exists to
 *  remove. Write and Edit are deliberately absent: standing permission to change
 *  files is the one thing the approval queue exists to hold on to. */
export function allowlistEntryFor(toolName: string, input: unknown): AllowlistEntry | null {
  const args = parseToolInput(input);

  if (toolName === 'Bash') {
    const command = args.command;
    return typeof command === 'string' && command ? { match: 'exact', value: command } : null;
  }

  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
    const filePath = (args.file_path ?? args.path) as unknown;
    if (typeof filePath !== 'string' || !filePath) return null;
    return { match: 'dirPrefix', value: dirOf(filePath) };
  }

  return null;
}
