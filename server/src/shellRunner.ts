/**
 * Shell bridge: runs PowerShell commands requested from the webview chat panel
 * and streams output back over the store broadcast channel.
 *
 * Scope/safety:
 *  - Standalone mode only; the HTTP/WS server binds to 127.0.0.1, so only
 *    local clients can trigger execution.
 *  - Output is streamed as ShellOutput chunks; every run ends with ShellExit.
 *  - One command per execId; concurrent commands are capped to avoid runaway
 *    process spawning from a misbehaving client.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';

import type { AgentStateStore } from './agentStateStore.js';

const MAX_CONCURRENT = 3;
const TIMEOUT_MS = 10 * 60 * 1000;
/** Force UTF-8 output so Korean text survives the pipe. */
const ENCODING_PREAMBLE =
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ';

const running = new Map<string, { proc: ChildProcessWithoutNullStreams; timer: NodeJS.Timeout }>();

function broadcastOutput(
  store: AgentStateStore,
  execId: string,
  stream: 'stdout' | 'stderr' | 'system',
  data: string,
): void {
  store.broadcast({ type: 'shellOutput', execId, stream, data });
}

function broadcastExit(
  store: AgentStateStore,
  execId: string,
  exitCode?: number,
  error?: string,
): void {
  store.broadcast({ type: 'shellExit', execId, exitCode, error });
}

export function runShellCommand(
  store: AgentStateStore,
  execId: string,
  command: string,
  cwd?: string,
): void {
  if (!execId || !command.trim()) return;
  if (running.has(execId)) return;
  if (running.size >= MAX_CONCURRENT) {
    broadcastExit(store, execId, undefined, `동시 실행 한도(${MAX_CONCURRENT}개) 초과`);
    return;
  }

  let proc: ChildProcessWithoutNullStreams;
  try {
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ENCODING_PREAMBLE + command],
      { cwd: cwd || process.cwd(), windowsHide: true },
    );
  } catch (err) {
    broadcastExit(store, execId, undefined, `실행 실패: ${err}`);
    return;
  }

  // Nothing is ever written to stdin; close it so commands that read stdin
  // (e.g. `claude -p`) don't stall waiting for input that never comes.
  proc.stdin.end();

  const timer = setTimeout(() => {
    broadcastOutput(store, execId, 'system', `10분 제한 시간 초과 — 프로세스를 종료합니다.\n`);
    proc.kill('SIGTERM');
  }, TIMEOUT_MS);
  running.set(execId, { proc, timer });

  console.log(`[Pixel Agents] Shell exec ${execId}: ${command.slice(0, 120)}`);

  proc.stdout.setEncoding('utf-8');
  proc.stderr.setEncoding('utf-8');
  proc.stdout.on('data', (data: string) => broadcastOutput(store, execId, 'stdout', data));
  proc.stderr.on('data', (data: string) => broadcastOutput(store, execId, 'stderr', data));

  proc.on('error', (err) => {
    clearTimeout(timer);
    running.delete(execId);
    broadcastExit(store, execId, undefined, `실행 실패: ${err.message}`);
  });
  proc.on('close', (code) => {
    clearTimeout(timer);
    running.delete(execId);
    broadcastExit(store, execId, code ?? undefined);
  });
}

export function killShellCommand(store: AgentStateStore, execId: string): void {
  const entry = running.get(execId);
  if (!entry) return;
  broadcastOutput(store, execId, 'system', '사용자 요청으로 중단합니다.\n');
  entry.proc.kill('SIGTERM');
}

/** Terminate everything on server shutdown. */
export function disposeShellRunner(): void {
  for (const [, { proc, timer }] of running) {
    clearTimeout(timer);
    proc.kill('SIGTERM');
  }
  running.clear();
}
