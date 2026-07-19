/**
 * Reading and writing the small JSON files under ~/.pixel-agents/.
 *
 * Five callers (layout, config, adapter state, staff roster, tool permissions)
 * each used to spell out the same read-or-null and write-via-temp dance. They
 * had drifted: only the roster set an owner-only mode, only the layout reported
 * whether the write landed, and only the roster wrote straight over the real
 * file with no temp at all. Collecting them here makes every file get the
 * strongest version of each.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse a JSON file, or null if it isn't there or isn't readable.
 *
 * Deliberately dumb: it says nothing about what the parsed value should look
 * like. Callers know their own shape and have their own reasons to be strict —
 * the permissions file fails closed on a bad structure, the roster normalizes
 * legacy role names — so validation stays with them.
 */
export function readJson(filePath: string, label: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.warn(`[Pixel Agents] ${label} unreadable:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Write JSON so the file on disk is never half-written.
 *
 * Writes a temp file beside the target and renames it over. Rename is atomic,
 * so a crash or a power cut leaves either the whole old file or the whole new
 * one — never a truncated file. The roster in particular holds the entire staff
 * list and any keys they were hired with; losing it to a mid-write crash costs
 * the user their office.
 *
 * `mode` (e.g. 0o600 for the roster, which stores credentials) is applied at
 * creation, which is why the stale temp is removed first: fs.writeFileSync only
 * honors `mode` when it actually creates the file, so writing over a temp left
 * behind by an earlier crashed run would silently keep that file's old, wider
 * permissions. Renaming carries the mode across, so the real file lands locked.
 *
 * Returns false instead of throwing when the write fails (disk full, no
 * permission). Callers acting on a user's explicit "save" check it so they can
 * say the save didn't stick, rather than letting the user believe a layout was
 * kept and find it rolled back on restart.
 */
export function writeJsonAtomic(
  filePath: string,
  data: unknown,
  opts?: { mode?: number },
): boolean {
  const tmpPath = filePath + '.tmp';
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.rmSync(tmpPath, { force: true });
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', {
      encoding: 'utf-8',
      ...(opts?.mode !== undefined ? { mode: opts.mode } : {}),
    });
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    console.error(`[Pixel Agents] Failed to write ${path.basename(filePath)}:`, err);
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      /* the temp is already gone, or we can't touch it — nothing left to do */
    }
    return false;
  }
}
