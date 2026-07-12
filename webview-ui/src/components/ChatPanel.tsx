import { useEffect, useRef, useState } from 'react';

import type { ServerMessage } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';

/** Left-side slide-out chat panel.
 *  Claude mode talks to a persistent Claude session running in the chosen
 *  folder (server-side, via the Agent SDK), so context carries across
 *  messages; tool calls that need approval surface as a card here.
 *  Shell mode keeps the original one-off PowerShell bridge. */

type EntryKind = 'cmd' | 'stdout' | 'stderr' | 'system' | 'user' | 'agent' | 'tool';

interface Entry {
  kind: EntryKind;
  text: string;
}

interface PermissionRequest {
  requestId: string;
  toolName: string;
  title: string;
  input: string;
}

const KIND_CLASS: Record<EntryKind, string> = {
  cmd: 'text-accent-bright',
  stdout: 'text-text',
  stderr: 'text-red-400',
  system: 'text-text-muted',
  user: 'text-accent-bright',
  agent: 'text-text',
  tool: 'text-text-muted',
};

type InputMode = 'claude' | 'shell';

const CWD_STORAGE_KEY = 'pixel-agents.agentCwd';

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<InputMode>('claude');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [runningExecId, setRunningExecId] = useState<string | null>(null);
  const [cwd, setCwd] = useState(() => localStorage.getItem(CWD_STORAGE_KEY) ?? '');
  const [sessionRunning, setSessionRunning] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const execIdRef = useRef<string | null>(null);

  const append = (kind: EntryKind, text: string) => {
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      // Merge consecutive chunks of the same stream to keep the list small.
      if (last && last.kind === kind && kind !== 'cmd' && kind !== 'user') {
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
      } else if (msg.type === 'agentSessionState') {
        // This also fires when the session reports a model switch — only log
        // the start/stop transition, not every state broadcast.
        setSessionRunning((prev) => {
          if (prev !== msg.running) {
            append(
              'system',
              msg.running ? `— Claude 세션 시작 (${msg.cwd}) —\n` : '— Claude 세션 종료 —\n',
            );
          }
          return msg.running;
        });
      } else if (msg.type === 'agentEvent') {
        if (msg.kind === 'user') append('user', `\n> ${msg.text}\n`);
        else if (msg.kind === 'text') append('agent', msg.text);
        else if (msg.kind === 'tool') append('tool', `\n[도구: ${msg.text}]\n`);
        else if (msg.kind === 'result' && msg.text) append('stderr', `\n${msg.text}\n`);
      } else if (msg.type === 'agentPermissionRequest') {
        setPermission({
          requestId: msg.requestId,
          toolName: msg.toolName,
          title: msg.title,
          input: msg.input,
        });
      }
    });
    return unsubscribe;
  }, []);

  // Auto-start the session on load when a folder was saved earlier.
  useEffect(() => {
    if (cwd) transport.send({ type: 'startAgentSession', cwd });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the log pinned to the bottom as output streams in.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, permission]);

  const startSession = () => {
    localStorage.setItem(CWD_STORAGE_KEY, cwd);
    transport.send({ type: 'startAgentSession', cwd });
  };

  const stopSession = () => {
    transport.send({ type: 'stopAgentSession' });
  };

  const decide = (allow: boolean) => {
    if (!permission) return;
    transport.send({
      type: 'agentPermissionDecision',
      requestId: permission.requestId,
      allow,
    });
    append('tool', `[${permission.toolName}: ${allow ? '허용' : '거부'}]\n`);
    setPermission(null);
  };

  const run = () => {
    const text = input.trim();
    if (!text) return;

    if (mode === 'claude') {
      if (!sessionRunning) {
        append('system', '먼저 폴더를 지정하고 세션을 시작하세요.\n');
        return;
      }
      transport.send({ type: 'sendAgentMessage', text });
      setInput('');
      return;
    }

    if (runningExecId) return;
    const execId = crypto.randomUUID();
    execIdRef.current = execId;
    setRunningExecId(execId);
    append('cmd', `> ${text}\n`);
    transport.send({ type: 'runShellCommand', execId, command: text });
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
    <div className="absolute left-10 top-10 bottom-10 z-20 pixel-panel p-8 flex flex-col gap-6 w-510 max-w-[70vw]">
      <div className="flex items-center justify-between gap-8">
        <span className="text-sm whitespace-nowrap">
          {mode === 'claude' ? 'Claude 세션' : '터미널 (PowerShell)'}
        </span>
        <div className="flex gap-4">
          <Button
            variant="default"
            size="sm"
            onClick={() => setMode(mode === 'claude' ? 'shell' : 'claude')}
            title={mode === 'claude' ? '셸 명령 모드로 전환' : 'Claude 모드로 전환'}
            data-testid="chat-mode-toggle"
          >
            {mode === 'claude' ? 'Claude' : '셸'}
          </Button>
          <Button variant="default" size="sm" onClick={() => setIsOpen(false)} title="닫기">
            ◀
          </Button>
        </div>
      </div>

      {mode === 'claude' && (
        <div className="flex items-center gap-4">
          <input
            className="flex-1 bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="작업 폴더 (예: F:\SecondBrain)"
            disabled={sessionRunning}
            data-testid="agent-cwd-input"
          />
          {sessionRunning ? (
            <Button variant="default" size="sm" onClick={stopSession}>
              중지
            </Button>
          ) : (
            <Button variant="default" size="sm" onClick={startSession}>
              시작
            </Button>
          )}
        </div>
      )}

      <div
        ref={logRef}
        className="flex-1 overflow-y-auto bg-bg-dark border-2 border-border rounded-none p-6 font-mono text-xs whitespace-pre-wrap break-all"
        data-testid="chat-log"
      >
        {entries.length === 0 ? (
          <span className="text-text-muted">
            {mode === 'claude'
              ? '작업 폴더를 지정하고 [시작]을 누르면 그 폴더에서 Claude 세션이 뜹니다.\n' +
                '이후 지시 내용만 입력하면 됩니다. 대화 맥락은 이어집니다.\n' +
                '파일 수정·명령 실행처럼 승인이 필요한 작업은 아래에 카드로 뜹니다.'
              : 'PowerShell 명령이 이 PC에서 그대로 실행됩니다.\n' + '예: git status / ls'}
          </span>
        ) : (
          entries.map((e, i) => (
            <span key={i} className={KIND_CLASS[e.kind]}>
              {e.text}
            </span>
          ))
        )}
      </div>

      {permission && (
        <div className="border-2 border-accent-bright rounded-none p-6 flex flex-col gap-4">
          <span className="text-xs">
            {permission.title || `Claude가 ${permission.toolName} 사용을 요청합니다`}
          </span>
          <span className="font-mono text-xs text-text-muted break-all">{permission.input}</span>
          <div className="flex gap-4">
            <Button variant="default" size="sm" onClick={() => decide(true)}>
              허용
            </Button>
            <Button variant="default" size="sm" onClick={() => decide(false)}>
              거부
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        <input
          className="flex-1 bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
          placeholder={
            mode === 'claude'
              ? sessionRunning
                ? '지시 내용 입력 후 Enter'
                : '세션을 먼저 시작하세요'
              : runningExecId
                ? '실행 중…'
                : '명령 입력 후 Enter'
          }
          disabled={mode === 'shell' && runningExecId !== null}
          data-testid="chat-input"
        />
        {mode === 'shell' && runningExecId ? (
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
