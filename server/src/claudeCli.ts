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

/** How to spawn the claude CLI on a given platform. See buildClaudeSpawn. */
export interface ClaudeSpawnSpec {
  command: string;
  /** Present only when `shell` is false (POSIX): the argv passed straight through. */
  args?: string[];
  shell: boolean;
}

/**
 * Quote one Windows shell argument — but only when it actually needs it. Args
 * with no shell-significant characters are returned untouched, so the common
 * case (our fixed literal flags like `-p`, `/usage`) produces a command string
 * byte-identical to what Node's own args+shell join used to build — no
 * behavior change. Args that DO contain spaces or metacharacters get wrapped in
 * double quotes (with embedded quotes doubled), which is the defense-in-depth
 * that closes the injection footgun the old `spawn(cmd, args, {shell:true})`
 * form left open (Node concatenated args unescaped — DEP0190).
 */
function quoteWinArg(arg: string): string {
  if (arg === '') return '""';
  if (/[\s"&|<>^()%!]/.test(arg)) return `"${arg.replace(/"/g, '""')}"`;
  return arg;
}

/**
 * Decide how to spawn `claude <args>` on `platform`. Pure + exported so the
 * platform branching is unit-testable without actually spawning.
 *
 * - POSIX: no shell at all. `spawn('claude', args)` passes argv straight to the
 *   OS with zero shell interpretation, so there is no injection surface.
 * - Windows: claude installs as `claude.cmd`, and since CVE-2024-27980 Node
 *   *requires* `shell: true` to run a `.cmd`/`.bat`. But `shell:true` together
 *   with an args array is the DEP0190 footgun (Node joins them unescaped). So we
 *   build ONE command string ourselves and quote each arg, avoiding both.
 */
export function buildClaudeSpawn(
  args: string[],
  platform: NodeJS.Platform = process.platform,
): ClaudeSpawnSpec {
  if (platform === 'win32') {
    return { command: ['claude', ...args.map(quoteWinArg)].join(' '), shell: true };
  }
  return { command: 'claude', args, shell: false };
}

/**
 * Run `claude <args>` and resolve with its result — never rejects. Timeouts
 * and spawn errors (ENOENT, etc.) both resolve to a CliResult so callers
 * don't need two error-handling paths.
 *
 * Callers should still pass fixed, literal argv (no user input): buildClaudeSpawn
 * quotes on Windows as defense in depth, but keeping args literal is the primary
 * guarantee.
 */
export function runClaudeCli(args: string[], opts: RunClaudeCliOptions): Promise<CliResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CliResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const spec = buildClaudeSpawn(args);
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spec.shell
        ? spawn(spec.command, { shell: true, windowsHide: true, env: opts.env })
        : spawn(spec.command, spec.args ?? [], { windowsHide: true, env: opts.env });
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
