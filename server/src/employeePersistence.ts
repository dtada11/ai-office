/**
 * The staff roster: who works here and which folder they own. Read when the
 * office opens (everyone clocks back in) and rewritten on every hire/fire.
 * Conversations are NOT restored — each start is a fresh session.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

const ROSTER_PATH = path.join(os.homedir(), LAYOUT_FILE_DIR, 'employees.json');

export interface SavedEmployee {
  name: string;
  cwd: string;
  /** vp = the boss's assistant, the only one who may delegate. */
  role: 'vp' | 'staff';
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
    fs.writeFileSync(ROSTER_PATH, JSON.stringify({ employees }, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn('[Pixel Agents] failed to save the staff roster:', err);
  }
}
