/**
 * Onboarding prerequisite diagnostics.
 *
 * Two independent tracks, one per AuthMode:
 *  - subscription: is `claude` on PATH, and is it logged in? Both answered by
 *    spawning the real CLI in the same environment an employee session would
 *    get (see buildEnv) — a stray ANTHROPIC_API_KEY on the server host must
 *    not make this check silently pass.
 *  - apiKey: does the stored key look right, and does the API actually accept
 *    it? The validity check is a GET to /v1/models — zero tokens, zero
 *    dollars, but still enough to tell a live key from a dead one via 401.
 *
 * Korean remediation copy is intentionally NOT here — see setupCheckCopy.ts
 * in the webview. This module only reports evidence (id, status, detail).
 */

import type { AuthMode, SetupCheck } from '../../core/src/messages.js';
import { buildEnv, readOfficeProvider } from './aiProvider.js';
import { runClaudeCli } from './claudeCli.js';

const CLAUDE_INSTALLED_TIMEOUT_MS = 15_000;
/** First run pays for the shim's own startup cost, hence the generous budget. */
const CLAUDE_LOGGED_IN_TIMEOUT_MS = 45_000;
const API_KEY_VALID_TIMEOUT_MS = 10_000;
const DETAIL_MAX_LEN = 300;
const MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models?limit=1';
const ANTHROPIC_VERSION = '2023-06-01';

function truncate(text: string): string {
  return text.length > DETAIL_MAX_LEN ? text.slice(0, DETAIL_MAX_LEN) : text;
}

/** Last non-empty line of CLI stderr, truncated — the most likely place a
 *  Claude Code error message actually lands. */
function lastNonEmptyLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  return last ? truncate(last) : undefined;
}

export async function runSetupCheck(mode: AuthMode): Promise<SetupCheck[]> {
  // buildEnv strips ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN for subscription
  // mode — without this, a key sitting in the server host's own environment
  // would make claudeLoggedIn pass even when nobody is actually logged in.
  const env = buildEnv({ mode });
  return mode === 'subscription' ? runSubscriptionChecks(env) : runApiKeyChecks();
}

async function runSubscriptionChecks(env: NodeJS.ProcessEnv): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];

  const version = await runClaudeCli(['--version'], {
    timeoutMs: CLAUDE_INSTALLED_TIMEOUT_MS,
    env,
  });
  const installedOk = !version.spawnError && version.code === 0;
  checks.push(
    installedOk
      ? { id: 'claudeInstalled', status: 'ok', detail: truncate(version.stdout.trim()) }
      : {
          id: 'claudeInstalled',
          status: 'fail',
          detail: version.spawnError ?? `종료 코드 ${String(version.code)}`,
        },
  );

  if (!installedOk) {
    checks.push({ id: 'claudeLoggedIn', status: 'skip' });
    return checks;
  }

  // --no-session-persistence: a bare probe would otherwise leave a transcript
  // file that the office picks up as a new (ghost) session.
  const usage = await runClaudeCli(['-p', '--no-session-persistence', '/usage'], {
    timeoutMs: CLAUDE_LOGGED_IN_TIMEOUT_MS,
    env,
  });
  // Exit code only — /usage throttled within ~60s still exits 0 (it just omits
  // percentages), so this is not fooled by the throttle window.
  const loggedInOk = !usage.spawnError && usage.code === 0 && usage.stdout !== '';
  checks.push(
    loggedInOk
      ? { id: 'claudeLoggedIn', status: 'ok' }
      : {
          id: 'claudeLoggedIn',
          status: 'fail',
          detail: usage.spawnError ?? lastNonEmptyLine(usage.stderr),
        },
  );
  return checks;
}

async function runApiKeyChecks(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  // The secret persists across mode switches (see aiProvider.ts), so this is
  // the last key the user typed regardless of which mode is active right now.
  const apiKey = readOfficeProvider().apiKey?.trim();
  const formatOk = !!apiKey && apiKey.startsWith('sk-ant-');
  checks.push({ id: 'apiKeyFormat', status: formatOk ? 'ok' : 'fail' });

  if (!formatOk) {
    checks.push({ id: 'apiKeyValid', status: 'skip' });
    return checks;
  }

  checks.push(await checkApiKeyValid(apiKey));
  return checks;
}

/** GET /v1/models — the cheapest call that still distinguishes a live key
 *  (200) from a dead one (401/403): zero tokens, zero dollars, no side
 *  effects. Deliberately NOT a /v1/messages call — see setupCheck 지시서 for
 *  why (would bill a stranger's card, and a hardcoded model id can be
 *  unavailable on a perfectly valid key/tier). */
async function checkApiKeyValid(apiKey: string): Promise<SetupCheck> {
  try {
    const res = await fetch(MODELS_ENDPOINT, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      signal: AbortSignal.timeout(API_KEY_VALID_TIMEOUT_MS),
    });

    if (res.status === 200) {
      let modelId: string | undefined;
      try {
        const body = (await res.json()) as { data?: Array<{ id?: string }> };
        modelId = body.data?.[0]?.id;
      } catch {
        // Body didn't parse as expected — still a 200, still ok.
      }
      return { id: 'apiKeyValid', status: 'ok', detail: modelId };
    }
    if (res.status === 401) {
      return { id: 'apiKeyValid', status: 'fail', detail: 'HTTP 401' };
    }
    if (res.status === 403) {
      return { id: 'apiKeyValid', status: 'fail', detail: 'HTTP 403' };
    }
    return { id: 'apiKeyValid', status: 'fail', detail: `HTTP ${res.status}` };
  } catch (err) {
    return {
      id: 'apiKeyValid',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
