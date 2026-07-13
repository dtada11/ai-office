/**
 * The staff roster: who works here and which folder they own. Read when the
 * office opens (everyone clocks back in) and rewritten on every hire/fire.
 * Conversations are NOT restored — each start is a fresh session.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { EmployeeProvider } from '../../core/src/messages.js';
import { LAYOUT_FILE_DIR } from './constants.js';

const ROSTER_PATH = path.join(os.homedir(), LAYOUT_FILE_DIR, 'employees.json');

export interface SavedEmployee {
  name: string;
  cwd: string;
  /** vp = the boss's assistant, the only one who may delegate. */
  role: 'vp' | 'staff';
  /** The model they were last working on. Absent = start them on the office default. */
  model?: string;
  /** The AI this employee brings themselves. Absent = follow the office default,
   *  which is why it is only written for employees who actually override it. */
  provider?: EmployeeProvider;
}

export function readEmployees(): SavedEmployee[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8')) as {
      employees?: SavedEmployee[];
    };
    return parsed.employees ?? [];
  } catch {
    return [];
  }
}

export function writeEmployees(employees: SavedEmployee[]): void {
  try {
    fs.mkdirSync(path.dirname(ROSTER_PATH), { recursive: true });
    // The roster can now hold an employee's own key, so keep it owner-readable.
    fs.writeFileSync(ROSTER_PATH, JSON.stringify({ employees }, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (err) {
    console.warn('[Pixel Agents] failed to save the staff roster:', err);
  }
}
