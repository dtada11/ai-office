import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Tool permission allowlist — one per employee, stored in ~/.pixel-agents/tool-permissions.json
 * Fail-closed: if the file is missing or corrupted, automode is simply disabled, not a crash
 */

/** A filesystem-safe, legible rendering of a name — the part of a key a human
 *  reads to tell whose bucket is whose. Both identities below are used as path
 *  or JSON-object segments, so a name carrying '/', '\' or spaces has to come
 *  out the other side harmless. */
function safeNameSegment(name: string): string {
  return name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Which employee's handoff notes these are, derived from their name. A
 *  sanitized name for legibility plus a short hash so two names that sanitize
 *  alike stay separate.
 *
 *  Name-derived on purpose, and only safe for notes: the next person to hold a
 *  name is *meant* to find the last one's notes (see hireEmployee's
 *  handoffFromKey — a differently-named hire can resume anyone's shift). That
 *  same inheritance is exactly what an allowlist must not do, which is why
 *  permissions no longer key off this. Knowledge is handed down; permission is
 *  not.
 *
 *  employees.ts re-exports this as handoffKey. Defined here (not there) for
 *  historical reasons — employees.ts already imports employee.ts, so the
 *  reverse edge would have been a cycle. */
export function employeeKey(name: string): string {
  const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 8);
  const safe = safeNameSegment(name);
  return safe ? `${safe}-${hash}` : hash;
}

/** A brand-new allowlist identity, minted once when someone is hired and then
 *  carried on the roster for as long as they work here.
 *
 *  The name in front is decoration — it is there so the user can tell whose
 *  bucket is whose with the file open. The random half is the identity, and it
 *  is what makes a key unguessable from a name: fire someone and hire another
 *  by the same name, and the newcomer cannot so much as name the bucket their
 *  predecessor filled. No comparison step blocks the inheritance; there is
 *  simply nothing to inherit.
 *
 *  Must NOT be derived from the session id: session ids are reissued on /clear
 *  and on clock-out/clock-in, and `ClaudeEmployee.sessionId` starts as '' —
 *  keying on it dropped every allowlist on restart once already (9dd36bd), and
 *  bucketed every employee who acted early under a shared '' key. */
export function newPermissionKey(name: string): string {
  const nonce = crypto.randomBytes(4).toString('hex');
  const safe = safeNameSegment(name);
  return safe ? `${safe}-${nonce}` : nonce;
}

export interface ToolPermission {
  tool: string;
  match: 'exact' | 'dirPrefix';
  value: string;
  addedAt: string; // ISO timestamp
}

export interface ToolPermissionsData {
  version: 1;
  byEmployee: Record<string, { allow: ToolPermission[] }>;
}

const PERMISSIONS_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.pixel-agents',
  'tool-permissions.json',
);

// Metachars that enable command chaining/substitution/redirection — if present, disallow automode
const BASH_DANGER_CHARS = [';', '&&', '||', '|', '&', '`', '$(', '>', '>>', '<', '\n'];

/**
 * Load tool permissions from disk. Returns empty structure if file doesn't exist or is corrupt.
 * Fail-closed: missing file = automode disabled for that employee.
 */
export function loadToolPermissions(): ToolPermissionsData {
  try {
    if (!fs.existsSync(PERMISSIONS_FILE)) {
      return { version: 1, byEmployee: {} };
    }
    const content = fs.readFileSync(PERMISSIONS_FILE, 'utf-8');
    const data = JSON.parse(content);
    // Validate basic structure. The null check is not redundant: typeof null is
    // 'object', so a file holding "byEmployee": null would pass a bare typeof
    // test and then throw on the first property read — a crash, which is the one
    // thing a fail-closed loader must never do.
    if (data.version !== 1 || !data.byEmployee || typeof data.byEmployee !== 'object') {
      console.warn('[toolPermissions] Invalid structure, resetting');
      return { version: 1, byEmployee: {} };
    }
    return data;
  } catch (e) {
    console.warn('[toolPermissions] Failed to load:', e instanceof Error ? e.message : String(e));
    return { version: 1, byEmployee: {} };
  }
}

/**
 * Save tool permissions to disk. Must be atomic to prevent corruption.
 */
export function saveToolPermissions(data: ToolPermissionsData): void {
  try {
    const dir = path.dirname(PERMISSIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Write to temp file first, then rename (atomic)
    const tempFile = PERMISSIONS_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, PERMISSIONS_FILE);
  } catch (e) {
    console.error('[toolPermissions] Failed to save:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Check if a Bash command contains dangerous metacharacters that enable command chaining.
 * This blocks the automode button on the UI — the command cannot be added to allowlist.
 */
export function hasDangerousBashMetachars(command: string): boolean {
  for (const char of BASH_DANGER_CHARS) {
    if (command.includes(char)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize a file path for comparison: absolute, forward slashes, lowercase drive letter.
 */
export function normalizePath(p: string): string {
  const abs = path.resolve(p);
  // Convert to forward slashes
  let normalized = abs.replace(/\\/g, '/');
  // On Windows, lowercase the drive letter (C: vs c:)
  if (/^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

/**
 * Check if a path matches an allowlist entry.
 * - exact: path must equal exactly
 * - dirPrefix: path must start with directory + '/' (segment-boundary-aware)
 */
export function pathMatches(
  actualPath: string,
  allowlistValue: string,
  match: 'exact' | 'dirPrefix',
): boolean {
  const actual = normalizePath(actualPath);
  const allow = normalizePath(allowlistValue);

  if (match === 'exact') {
    return actual === allow;
  }

  if (match === 'dirPrefix') {
    // Must be a child of the directory: directory + '/' + something
    if (actual === allow) return true;
    if (actual.startsWith(allow + '/')) return true;
    return false;
  }

  return false;
}

/**
 * Add a permission to an employee's allowlist. Returns true if added, false if already present.
 */
export function addPermission(employeeKey: string, perm: ToolPermission): boolean {
  const data = loadToolPermissions();
  if (!data.byEmployee[employeeKey]) {
    data.byEmployee[employeeKey] = { allow: [] };
  }

  // Check for duplicate (exact match on tool + match type + value)
  const isDuplicate = data.byEmployee[employeeKey].allow.some(
    (p) => p.tool === perm.tool && p.match === perm.match && p.value === perm.value,
  );

  if (isDuplicate) {
    return false;
  }

  data.byEmployee[employeeKey].allow.push(perm);
  saveToolPermissions(data);
  return true;
}

/**
 * Remove a permission from an employee's allowlist.
 */
export function removePermission(
  employeeKey: string,
  toolName: string,
  match: string,
  value: string,
): boolean {
  const data = loadToolPermissions();
  if (!data.byEmployee[employeeKey]) {
    return false;
  }

  const before = data.byEmployee[employeeKey].allow.length;
  data.byEmployee[employeeKey].allow = data.byEmployee[employeeKey].allow.filter(
    (p) => !(p.tool === toolName && p.match === match && p.value === value),
  );

  if (data.byEmployee[employeeKey].allow.length < before) {
    saveToolPermissions(data);
    return true;
  }

  return false;
}

/**
 * Clear all permissions for an employee.
 */
export function clearEmployeePermissions(employeeKey: string): void {
  const data = loadToolPermissions();
  delete data.byEmployee[employeeKey];
  saveToolPermissions(data);
}

/**
 * Check if a tool use is auto-approved for an employee.
 * Returns the matching permission if approved, null if not.
 */
export function checkAutoApproval(
  employeeKey: string,
  toolName: string,
  input: Record<string, unknown>,
): ToolPermission | null {
  const data = loadToolPermissions();
  const perms = data.byEmployee[employeeKey]?.allow || [];

  // Find first matching permission
  for (const perm of perms) {
    if (perm.tool !== toolName) continue;

    // Extract the relevant field based on tool type
    let compareValue: string | null = null;
    switch (toolName) {
      case 'Read':
      case 'Edit':
      case 'Write':
        compareValue = (input.file_path as string) || null;
        break;
      case 'Grep':
      case 'Glob':
        compareValue = (input.path as string) || null;
        break;
      case 'Bash':
        compareValue = (input.command as string) || null;
        break;
      default:
        return null;
    }

    if (!compareValue) continue;

    if (perm.match === 'exact') {
      if (compareValue === perm.value) {
        return perm;
      }
    } else if (perm.match === 'dirPrefix') {
      if (pathMatches(compareValue, perm.value, 'dirPrefix')) {
        return perm;
      }
    }
  }

  return null;
}
