import { useEffect, useRef, useState } from 'react';

import type { ServerMessage } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';

/** Left-side slide-out chat panel bridging to a server-side PowerShell.
 *  An arrow toggle on the left edge opens the panel; each submitted line is
 *  executed via RunShellCommand and stdout/stderr stream back into the log.
 *  Claude Code work runs through the same bridge, e.g. `claude -p "지시"`. */

type EntryKind = 'cmd' | 'stdout' | 'stderr' | 'system';

interface Entry {
  kind: EntryKind;
  text: string;
}

const KIND_CLASS: Record<EntryKind, string> = {
  cmd: 'text-accent-bright',
  stdout: 'text-text',
  stderr: 'text-red-400',
  system: 'text-text-muted',
};

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [runningExecId, setRunningExecId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const execIdRef = useRef<string | null>(null);

  const append = (kind: EntryKind, text: string) => {
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      // Merge consecutive chunks of the same stream to keep the list small.
      if (last && last.kind === kind && kind !== 'cmd') {
        return [...prev.slice(0, -1), { kind, text: last.text + text }];
      }
      return [...prev, { kind, text }];
    });
  };

  useEffect(() => {
    const unsubscribe = transport.onMessage((msg: ServerMessage) => {
      if (msg.type === 'shellOutput' && msg.execId === execIdRef.current) {
        append(msg.stream, msg.data);
      } else if (msg.type === 'shellExit' && msg.execId === execIdRef.current) {
        if (msg.error) {
          append('system', `⚠ ${msg.error}\n`);
        } else {
          append('system', `— 종료 (exit ${msg.exitCode ?? '?'}) —\n`);
        }
        execIdRef.current = null;
        setRunningExecId(null);
      }
    });
    return unsubscribe;
  }, []);

  // Keep the log pinned to the bottom as output streams in.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const run = () => {
    const command = input.trim();
    if (!command || runningExecId) return;
    const execId = crypto.randomUUID();
    execIdRef.current = execId;
    setRunningExecId(execId);
    append('cmd', `> ${command}\n`);
    transport.send({ type: 'runShellCommand', execId, command });
    setInput('');
  };

  const kill = () => {
    if (runningExecId) {
      transport.send({ type: 'killShellCommand', execId: runningExecId });
    }
  };

  if (!isOpen) {
    return (
      <div className="absolute left-10 top-1/2 -translate-y-1/2 z-20">
        <Button
          variant="default"
          size="sm"
          onClick={() => setIsOpen(true)}
          title="터미널 채팅 열기"
        >
          ▶
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute left-10 top-10 bottom-10 z-20 pixel-panel p-8 flex flex-col gap-6 w-340 max-w-[70vw]">
      <div className="flex items-center justify-between gap-8">
        <span className="text-sm whitespace-nowrap">터미널 (PowerShell)</span>
        <Button variant="default" size="sm" onClick={() => setIsOpen(false)} title="닫기">
          ◀
        </Button>
      </div>
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto bg-bg-dark border-2 border-border rounded-none p-6 font-mono text-xs whitespace-pre-wrap break-all"
        data-testid="chat-log"
      >
        {entries.length === 0 ? (
          <span className="text-text-muted">
            {'PowerShell 명령이 이 PC에서 그대로 실행됩니다.\n'}
            {'Claude에게 일 시키기: claude -p "지시 내용"\n'}
            {'예: git status / ls / claude -p "이 폴더 요약해줘"'}
          </span>
        ) : (
          entries.map((e, i) => (
            <span key={i} className={KIND_CLASS[e.kind]}>
              {e.text}
            </span>
          ))
        )}
      </div>
      <div className="flex gap-4">
        <input
          className="flex-1 bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
          placeholder={runningExecId ? '실행 중…' : '명령 입력 후 Enter'}
          disabled={runningExecId !== null}
          data-testid="chat-input"
        />
        {runningExecId ? (
          <Button variant="default" size="sm" onClick={kill}>
            중단
          </Button>
        ) : (
          <Button variant="default" size="sm" onClick={run}>
            실행
          </Button>
        )}
      </div>
    </div>
  );
}
