import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Helpers for the user-level Claude Code settings file (~/.claude/settings.json).
 *  Used by the token gauge: read the configured model (context-limit heuristic)
 *  and write a new default model. Writing affects NEW sessions only — a running
 *  Claude Code session cannot be switched from outside. */

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const CONTEXT_LIMIT_DEFAULT = 200_000;
const CONTEXT_LIMIT_1M = 1_000_000;
const MODEL_CACHE_TTL_MS = 30_000;

let cachedModel: string | undefined;
let cachedAt = 0;

function readSettings(): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Configured default model from settings.json (cached for 30 s). */
export function getConfiguredModel(): string | undefined {
  const now = Date.now();
  if (now - cachedAt > MODEL_CACHE_TTL_MS) {
    const settings = readSettings();
    cachedModel = typeof settings?.model === 'string' ? settings.model : undefined;
    cachedAt = now;
  }
  return cachedModel;
}

/** Context window for the configured model: 1M for "[1m]" variants, else 200k. */
export function getContextLimit(): number {
  return getConfiguredModel()?.includes('[1m]') ? CONTEXT_LIMIT_1M : CONTEXT_LIMIT_DEFAULT;
}

/** Write the model key into settings.json (atomic tmp+rename, preserves other keys). */
export function setConfiguredModel(model: string): boolean {
  const settings = readSettings();
  if (!settings) return false;
  settings.model = model;
  try {
    const tmp = `${SETTINGS_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, SETTINGS_PATH);
    cachedModel = model;
    cachedAt = Date.now();
    return true;
  } catch (err) {
    console.error('[Pixel Agents] Failed to write model to settings.json:', err);
    return false;
  }
}
