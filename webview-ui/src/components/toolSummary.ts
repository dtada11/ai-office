/** Turns a tool call's raw JSON input into something a human can read at a
 *  glance — the server only hands over the tool name and a (possibly
 *  truncated) JSON string; parsing and presentation belong to the webview.
 *
 *  Every export here must degrade, never throw: `input` can be absent, or
 *  cut off mid-string at the server's 2000-char cap (see employee.ts,
 *  TOOL_INPUT_MAX), which leaves the JSON syntactically broken. A best-effort
 *  answer (or the bare tool name) beats a crashed chat window. */

const TOOL_DISPLAY_NAME: Record<string, string> = {
  mcp__office__delegate: '위임',
  mcp__office__collect: '수거',
  mcp__office__list_staff: '팀원 확인',
};

/** What to call a tool on screen — office delegation tools get a Korean label,
 *  everything else shows as-is (Edit, Bash, Read, …). */
export function displayToolName(toolName: string): string {
  return TOOL_DISPLAY_NAME[toolName] ?? toolName;
}

export type ToolCategory = 'read' | 'write' | 'exec' | 'delegate' | 'other';

const READ_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'mcp__office__list_staff',
]);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EXEC_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell']);
const DELEGATE_TOOLS = new Set(['mcp__office__delegate', 'mcp__office__collect']);

/** Read vs write vs exec vs delegate — used only to pick an accent token in
 *  the UI, so an unrecognized tool safely falls into 'other'. */
export function categorizeTool(toolName: string): ToolCategory {
  if (DELEGATE_TOOLS.has(toolName)) return 'delegate';
  if (WRITE_TOOLS.has(toolName)) return 'write';
  if (EXEC_TOOLS.has(toolName)) return 'exec';
  if (READ_TOOLS.has(toolName)) return 'read';
  return 'other';
}

/** JSON.parse that answers with undefined instead of throwing — truncated or
 *  absent input is expected here, not exceptional. */
function tryParseJson(input: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(input);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Hand-scans for `"key":"value"` when the JSON around it doesn't parse as a
 *  whole (truncation cuts the tail off, but an early field is usually still
 *  intact). Stops at the first unescaped quote or the end of the string,
 *  whichever comes first — a value cut off mid-way still comes back as
 *  whatever prefix was captured, which is more useful than nothing. */
function recoverField(raw: string, key: string): string | undefined {
  const marker = `"${key}"`;
  const markerAt = raw.indexOf(marker);
  if (markerAt === -1) return undefined;
  const colonAt = raw.indexOf(':', markerAt + marker.length);
  if (colonAt === -1) return undefined;

  let i = colonAt + 1;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== '"') return undefined;
  i++;

  let out = '';
  while (i < raw.length && raw[i] !== '"') {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      out += raw[i + 1];
      i += 2;
    } else {
      out += raw[i];
      i++;
    }
  }
  return out;
}

/** A field's value, preferring a clean parse but falling back to the hand
 *  scan when the JSON as a whole didn't parse. */
function field(
  raw: string,
  parsed: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const fromParsed = parsed ? parsed[key] : undefined;
  if (typeof fromParsed === 'string' && fromParsed) return fromParsed;
  return recoverField(raw, key);
}

const SUMMARY_MAX_CHARS = 72;

/** Collapses whitespace/newlines to fit a collapsed tool row on one line. */
function truncateOneLine(s: string, max = SUMMARY_MAX_CHARS): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** An absolute path is too long for a one-line summary — the last couple of
 *  segments are enough to recognize the file. Handles both path styles since
 *  tool input can come from either OS. */
export function shortenPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

/** One line describing what a tool call did, for the collapsed row. Returns
 *  the bare tool name whenever there's nothing better to say — no input, an
 *  unrecognized tool, or a field that didn't survive truncation. */
export function summarizeToolCall(toolName: string, input: string | undefined): string {
  if (!input) return toolName;
  const parsed = tryParseJson(input);
  const get = (key: string) => field(input, parsed, key);

  switch (toolName) {
    case 'mcp__office__delegate': {
      const name = get('name');
      if (!name) return toolName;
      const instruction = get('instruction');
      return instruction ? `${name}에게: ${truncateOneLine(instruction)}` : `${name}에게 위임`;
    }
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'MultiEdit': {
      const path = get('file_path');
      return path ? shortenPath(path) : toolName;
    }
    case 'NotebookEdit': {
      const path = get('notebook_path') ?? get('file_path');
      return path ? shortenPath(path) : toolName;
    }
    case 'Bash': {
      const command = get('command');
      return command ? truncateOneLine(command) : toolName;
    }
    case 'Grep':
    case 'Glob': {
      const pattern = get('pattern');
      return pattern ? truncateOneLine(pattern) : toolName;
    }
    case 'WebFetch': {
      const url = get('url');
      return url ? truncateOneLine(url) : toolName;
    }
    case 'WebSearch': {
      const query = get('query');
      return query ? truncateOneLine(query) : toolName;
    }
    case 'Task':
    case 'Agent': {
      const description = get('description');
      return description ? truncateOneLine(description) : toolName;
    }
    default:
      return toolName;
  }
}

/** The full input for the expanded view — pretty-printed if it parsed clean,
 *  otherwise the raw text verbatim. Never invents structure that isn't there. */
export function formatToolInput(input: string | undefined): string {
  if (!input) return '';
  const parsed = tryParseJson(input);
  if (parsed === undefined) return input;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return input;
  }
}

export interface EditDiff {
  oldString: string;
  newString: string;
}

/** old_string/new_string for an Edit permission request — undefined for any
 *  other tool, or if truncation cut the input before one of the two fields
 *  (a long old_string can push new_string past the 2000-char cap). */
export function editDiffFields(toolName: string, input: string | undefined): EditDiff | undefined {
  if (toolName !== 'Edit' || !input) return undefined;
  const parsed = tryParseJson(input);
  const get = (key: string): string | undefined => {
    const fromParsed = parsed ? parsed[key] : undefined;
    if (typeof fromParsed === 'string') return fromParsed;
    return recoverField(input, key);
  };
  const oldString = get('old_string');
  const newString = get('new_string');
  if (oldString === undefined || newString === undefined) return undefined;
  return { oldString, newString };
}
