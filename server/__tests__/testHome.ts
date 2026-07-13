/**
 * Point THIS process's home at an isolated temp dir for the duration of a test.
 *
 * macOS/Linux: os.homedir() honors $HOME, so setting HOME is enough.
 * Windows: os.homedir() reads USERPROFILE and IGNORES $HOME. A test that sets only
 * HOME therefore keeps resolving ~/.pixel-agents to the REAL profile — and writes
 * its fixtures over the user's actual layout/config. (This is the in-process twin
 * of applyMockHomeEnv in e2e/helpers/mock-claude.ts, which does the same for a
 * child process's env.) Clear the legacy HOMEDRIVE/HOMEPATH fallbacks too, so a
 * stale host value can't win when libuv falls back to them.
 */

const KEYS = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH'] as const;

export type SavedHome = Partial<Record<(typeof KEYS)[number], string>>;

export function redirectHome(tmpHome: string): SavedHome {
  const saved: SavedHome = {};
  for (const key of KEYS) saved[key] = process.env[key];

  process.env.HOME = tmpHome;
  if (process.platform === 'win32') {
    process.env.USERPROFILE = tmpHome;
    delete process.env.HOMEDRIVE;
    delete process.env.HOMEPATH;
  }
  return saved;
}

export function restoreHome(saved: SavedHome): void {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
