import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readOfficeProvider } from './aiProvider.js';

/** The model employees run on, and the context window that implies.
 *
 *  The office's own setting decides. Only a subscription-mode office falls back to
 *  the host's Claude Code settings (~/.claude/settings.json) — that file describes
 *  the machine's owner, so an employee running on someone else's key has no
 *  business inheriting it. */

function getSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

const CONTEXT_LIMIT_DEFAULT = 200_000;
const CONTEXT_LIMIT_1M = 1_000_000;
const MODEL_CACHE_TTL_MS = 30_000;

let cachedHostModel: string | undefined;
let cachedAt = 0;

function readSettings(): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The host's own default model, cached for 30 s. Subscription fallback only. */
function getHostModel(): string | undefined {
  const now = Date.now();
  if (now - cachedAt > MODEL_CACHE_TTL_MS) {
    const settings = readSettings();
    cachedHostModel = typeof settings?.model === 'string' ? settings.model : undefined;
    cachedAt = now;
  }
  return cachedHostModel;
}

/** The model employees are hired with: the office setting, else the host's
 *  (subscription only), else undefined — which leaves the SDK on its default. */
export function getConfiguredModel(): string | undefined {
  const office = readOfficeProvider();
  if (office.model) return office.model;
  if (office.mode !== 'subscription') return undefined;
  return getHostModel();
}

/** Context window for the configured model: 1M for "[1m]" variants, else 200k. */
export function getContextLimit(): number {
  return getConfiguredModel()?.includes('[1m]') ? CONTEXT_LIMIT_1M : CONTEXT_LIMIT_DEFAULT;
}
