/**
 * Which AI an employee is plugged into.
 *
 * The office used to inherit its credentials silently: the SDK picked whatever
 * the server host's environment happened to hold. Here that choice becomes an
 * explicit setting — an office default, overridable per employee — and this file
 * is the only place that turns it into an environment for a session.
 *
 * Secrets live in the home directory (~/.pixel-agents/ai-provider.json), never in
 * the repository, and are never sent to a client (see maskProvider).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AuthMode, EmployeeProvider } from '../../core/src/messages.js';
import { LAYOUT_FILE_DIR } from './constants.js';

function getProviderPath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, 'ai-provider.json');
}

/** The env vars the SDK reads, in its own order of precedence. */
const API_KEY_VAR = 'ANTHROPIC_API_KEY';
/** We never set this ourselves — subscription and apiKey are the only modes we
 *  offer — but we still strip it: a stray CLAUDE_CODE_OAUTH_TOKEN left in the
 *  server host's own environment would otherwise hijack subscription mode. */
const OAUTH_TOKEN_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';

export interface OfficeProviderConfig extends EmployeeProvider {
  /** Default model for employees; empty = fall back (see claudeSettings). */
  model?: string;
}

/** What the office falls back to when nothing is configured: today's behaviour,
 *  i.e. the local Claude Code login of whoever started the server. */
const DEFAULT_OFFICE_PROVIDER: OfficeProviderConfig = { mode: 'subscription' };

let cached: OfficeProviderConfig | null = null;

export function isAuthMode(value: unknown): value is AuthMode {
  return value === 'subscription' || value === 'apiKey';
}

export function readOfficeProvider(): OfficeProviderConfig {
  if (cached) return cached;
  try {
    const raw = JSON.parse(
      fs.readFileSync(getProviderPath(), 'utf8'),
    ) as Partial<OfficeProviderConfig>;
    cached = {
      mode: isAuthMode(raw.mode) ? raw.mode : DEFAULT_OFFICE_PROVIDER.mode,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
      model: typeof raw.model === 'string' ? raw.model : undefined,
    };
  } catch {
    cached = { ...DEFAULT_OFFICE_PROVIDER };
  }
  return cached;
}

export function writeOfficeProvider(config: OfficeProviderConfig): void {
  cached = config;
  try {
    const providerPath = getProviderPath();
    fs.mkdirSync(path.dirname(providerPath), { recursive: true });
    const tmp = `${providerPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmp, providerPath);
  } catch (err) {
    console.warn('[Pixel Agents] failed to save the office AI provider:', err);
  }
}

/** An employee's own provider, or the office default when they have none. */
export function resolveProvider(own?: EmployeeProvider): EmployeeProvider {
  return own ?? readOfficeProvider();
}

/** Legacy rosters may hold {mode:'oauthToken', oauthToken}. Unknown modes →
 *  undefined (= follow the office default); the dead field drops on next save. */
export function normalizeProvider(raw: unknown): EmployeeProvider | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const mode = (raw as { mode?: unknown }).mode;
  if (mode === 'apiKey') {
    const apiKey = (raw as { apiKey?: unknown }).apiKey;
    return { mode: 'apiKey', apiKey: typeof apiKey === 'string' ? apiKey : undefined };
  }
  if (mode === 'subscription') return { mode: 'subscription' };
  return undefined; // oauthToken 등 알 수 없는 모드 → 사무실 기본 따름
}

/** Everything a client may know about the office default — no secret. */
export function maskProvider(config: OfficeProviderConfig): {
  mode: AuthMode;
  hasSecret: boolean;
  model?: string;
} {
  return {
    mode: config.mode,
    hasSecret: secretFor(config) !== undefined,
    model: config.model,
  };
}

function secretFor(config: EmployeeProvider): string | undefined {
  if (config.mode === 'apiKey') return config.apiKey?.trim() || undefined;
  return undefined;
}

/**
 * The environment a session runs in.
 *
 * The SDK's `env` REPLACES the process environment rather than merging into it,
 * so PATH and HOME have to be carried over by hand — without them the CLI the SDK
 * spawns cannot even be found.
 *
 * Because the SDK reads ANTHROPIC_API_KEY before the subscription login, a key
 * left lying around in the server's own environment would silently outrank the
 * subscription. Every mode therefore starts by deleting BOTH credential vars and
 * then sets back only the one it wants — that deletion is what makes
 * `subscription` mean subscription.
 */
export function buildEnv(config: EmployeeProvider): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Windows env keys are case-insensitive, so a stray `Anthropic_Api_Key` has
    // to go too — an exact-name delete would leave it in and hijack the mode.
    const upper = key.toUpperCase();
    if (upper === API_KEY_VAR || upper === OAUTH_TOKEN_VAR) continue;
    env[key] = value;
  }

  const secret = secretFor(config);
  if (config.mode === 'apiKey' && secret) env[API_KEY_VAR] = secret;
  return env;
}
