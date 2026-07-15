/**
 * Shared spawn helper for invoking the `claude` CLI on the server host.
 *
 * Both the plan-usage probe and the onboarding setup check need to run a
 * fixed, literal argv against `claude` and read back stdout/stderr/exit code.
 * This is that one spawn path, so both callers behave identically (same
 * shell quirk, same timeout handling) instead of drifting.
 */

import { spawn } from 'child_process';

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be spawned at all (e.g. ENOENT — `claude`
   *  is not on PATH). When set, `code` is null and stdout/stderr are empty. */
  spawnError?: string;
}

export interface RunClaudeCliOptions {
  timeoutMs: number;
  /** Environment for the spawned process. Defaults to the current process env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Run `claude <args>` and resolve with its result — never rejects. Timeouts
 * and spawn errors (ENOENT, etc.) both resolve to a CliResult so callers
 * don't need two error-handling paths.
 *
 * `shell: true` is required on Windows, where Claude Code installs as
 * `claude.cmd` — a plain spawn without a shell cannot find/execute it.
 * Callers must only ever pass fixed, literal argv (no user input) since
 * `shell: true` interprets shell metacharacters.
 */
export function runClaudeCli(args: string[], opts: RunClaudeCliOptions): Promise<CliResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CliResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('claude', args, {
        shell: true,
        windowsHide: true,
        env: opts.env,
      });
    } catch (err) {
      finish({ code: null, stdout: '', stderr: '', spawnError: String(err) });
      return;
    }

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      finish({ code: null, stdout, stderr, spawnError: 'timeout' });
    }, opts.timeoutMs);

    proc.stdout?.setEncoding('utf-8');
    proc.stdout?.on('data', (chunk: string) => (stdout += chunk));
    proc.stderr?.setEncoding('utf-8');
    proc.stderr?.on('data', (chunk: string) => (stderr += chunk));
    proc.stdin?.end();

    proc.on('error', (err) => {
      clearTimeout(timer);
      finish({ code: null, stdout, stderr, spawnError: String(err) });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr });
    });
  });
}
