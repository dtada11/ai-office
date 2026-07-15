import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** One subdirectory found under a listed path. */
export interface DirEntry {
  name: string;
  path: string;
}

/** Result of listing a directory for the folder picker. */
export interface DirListing {
  /** Normalized absolute path of the listing, or '' for the starting
   *  screen (Windows drive list). */
  path: string;
  /** Absolute path to go up to, or null if already at the top. */
  parent: string | null;
  /** Subdirectories only -- files are excluded. Empty when `error` is true. */
  entries: DirEntry[];
  /** True if the path could not be read (missing, not a directory,
   *  permission denied, ...). Never thrown -- always degrades to this. */
  error: boolean;
}

/** List the subdirectories under `inputPath` for the folder picker. Read-only:
 *  never creates, deletes, or moves anything. Never throws -- every failure
 *  mode (missing path, not a directory, permission denied) degrades to
 *  `{ error: true, entries: [] }` so a bad path can't crash the server or
 *  leave the picker stuck. Empty/blank input returns the starting screen. */
export function listDirectory(inputPath: string | undefined): DirListing {
  const trimmed = (inputPath ?? '').trim();
  if (trimmed === '') {
    return listStartingPoints();
  }

  const normalized = path.resolve(trimmed);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalized);
  } catch {
    return { path: normalized, parent: parentOf(normalized), entries: [], error: true };
  }

  if (!stat.isDirectory()) {
    return { path: normalized, parent: parentOf(normalized), entries: [], error: true };
  }

  try {
    const dirents = fs.readdirSync(normalized, { withFileTypes: true });
    const entries: DirEntry[] = [];
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue;
      const fullPath = path.join(normalized, d.name);
      if (d.isDirectory()) {
        entries.push({ name: d.name, path: fullPath });
      } else if (d.isSymbolicLink()) {
        // Dirent.isDirectory() uses lstat semantics and is always false for
        // symlinks/junctions (notably on Windows), so a symlinked directory
        // would otherwise be silently dropped even though opening it directly
        // works fine (see the statSync call above, which does follow links).
        // Resolve the target with a single follow-through stat; a broken
        // link, permission error, or cycle only excludes this one entry.
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            entries.push({ name: d.name, path: fullPath });
          }
        } catch {
          // Broken symlink or unreadable target -- skip just this entry.
        }
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { path: normalized, parent: parentOf(normalized), entries, error: false };
  } catch {
    // Permission denied, or a transient read failure.
    return { path: normalized, parent: parentOf(normalized), entries: [], error: true };
  }
}

/** Parent to go "up" to. A POSIX root ('/') has nothing above it (null). A
 *  Windows drive root ('C:\\') still has somewhere to go: back to the drive
 *  list, i.e. the '' starting point -- without this special case, drilling
 *  into a drive would be a one-way trip with no way to pick a different one. */
function parentOf(dir: string): string | null {
  const up = path.dirname(dir);
  if (up !== dir) return up;
  return process.platform === 'win32' && /^[A-Za-z]:\\$/.test(dir) ? '' : null;
}

/** No path given: Windows shows the drive list, POSIX shows the home directory. */
function listStartingPoints(): DirListing {
  if (process.platform === 'win32') {
    const drives: DirEntry[] = [];
    for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) {
        drives.push({ name: drive, path: drive });
      }
    }
    return { path: '', parent: null, entries: drives, error: false };
  }

  return listDirectory(os.homedir());
}
