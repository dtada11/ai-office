/**
 * The staff roster: who works here and which folder they own. Read when the
 * office opens (everyone clocks back in) and rewritten on every hire/fire.
 * Conversations are NOT restored — each start is a fresh session.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { EmployeeProvider } from '../../core/src/messages.js';
import { normalizeProvider } from './aiProvider.js';
import { LAYOUT_FILE_DIR } from './constants.js';

function getRosterPath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, 'employees.json');
}

export interface SavedEmployee {
  name: string;
  cwd: string;
  /** lead = the only rank that may delegate. */
  role: 'lead' | 'staff';
  /** What to call them on screen. Absent = the default label for their role. */
  roleLabel?: string;
  /** Standing instructions, applied when the session starts. */
  persona?: string;
  /** The model they were last working on. Absent = start them on the office default. */
  model?: string;
  /** The AI this employee brings themselves. Absent = follow the office default,
   *  which is why it is only written for employees who actually override it. */
  provider?: EmployeeProvider;
  /** True when this employee clocked out before the roster was last saved.
   *  rehireSavedEmployees() registers them off duty instead of starting a
   *  session — no character until the user clocks them back in. */
  offDuty?: boolean;
  /** The look the webview assigned on first spawn (pickDiversePalette()).
   *  Frozen here so appearance is tied to this employee, not to their agentId —
   *  which shifts whenever someone earlier on the roster is fired. */
  palette?: number;
  hueShift?: number;
}

/** Legacy rosters say 'vp'. Anything unrecognized falls back to staff —
 *  a wrong role is worse than a demotion. The dead value drops on next save. */
function normalizeRole(raw: unknown): 'lead' | 'staff' {
  if (raw === 'lead' || raw === 'vp') return 'lead';
  return 'staff';
}

export function readEmployees(): SavedEmployee[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(getRosterPath(), 'utf8')) as {
      employees?: SavedEmployee[];
    };
    return (parsed.employees ?? []).map((e) => ({
      ...e,
      role: normalizeRole(e.role),
      provider: normalizeProvider(e.provider),
    }));
  } catch {
    return [];
  }
}

export function writeEmployees(employees: SavedEmployee[]): void {
  try {
    const rosterPath = getRosterPath();
    fs.mkdirSync(path.dirname(rosterPath), { recursive: true });
    // The roster can now hold an employee's own key, so keep it owner-readable.
    fs.writeFileSync(rosterPath, JSON.stringify({ employees }, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (err) {
    console.warn('[Pixel Agents] failed to save the staff roster:', err);
  }
}
