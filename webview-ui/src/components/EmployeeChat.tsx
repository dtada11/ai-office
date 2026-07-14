import { useEffect, useRef, useState } from 'react';

import type { ChatEntry, EmployeeInfo, PermissionRequest } from '../hooks/useExtensionMessages.js';
import { displayModel, MODEL_OPTIONS } from '../models.js';
import { transport } from '../transport/index.js';
import type { ChatPosition } from './chatWindowPosition.js';
import { clampChatPosition } from './chatWindowPosition.js';
import { Button } from './ui/Button.js';

/** One employee's chat window — the window IS their session. Several can be open
 *  at once, which is how the user works through approvals from parallel workers.
 *  Dragged by the header, and switched to its own model there: a cheap job need
 *  not be done on an expensive model just because the office default is. */

const KIND_CLASS: Record<ChatEntry['kind'], string> = {
  user: 'text-accent-bright',
  text: 'text-text',
  tool: 'text-text-muted',
  result: 'text-red-400',
  system: 'text-text-muted',
};

interface EmployeeChatProps {
  employee: EmployeeInfo;
  log: ChatEntry[];
  permission?: PermissionRequest;
  /** Whether the employee's turn is still in progress. */
  busy: boolean;
  /** What they're doing right now, while busy. */
  busyLabel: string;
  /** Where the window sits. Owned by App, so it survives closing and re-opening. */
  position: ChatPosition;
  onMove: (position: ChatPosition) => void;
  /** Bring this window to the front — it is the one being worked in. */
  onFocus: () => void;
  onClose: () => void;
  onDecided: () => void;
  /** A message was just sent — lets the caller mark the employee busy right away. */
  onSend: () => void;
}

export function EmployeeChat({
  employee,
  log,
  permission,
  busy,
  busyLabel,
  position,
  onMove,
  onFocus,
  onClose,
  onDecided,
  onSend,
}: EmployeeChatProps) {
  const [input, setInput] = useState('');
  const [isModelOpen, setIsModelOpen] = useState(false);
  /** The model just picked, shown at once so the click has an answer. The session
   *  only reports what it actually ran on at the next reply — and that wins. */
  const [picked, setPicked] = useState('');
  /** Grab offset while dragging: pointer minus window origin. Null = not dragging. */
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, permission]);

  // The reply reported a model: drop the optimistic label, whether or not it
  // agrees with the pick. What the session ran on is the only truth here.
  useEffect(() => {
    setPicked('');
  }, [employee.model]);

  // Listeners on the window, not on the header: bringing the window to the front
  // re-orders it in the DOM, which would drop a pointer capture held by the header.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      onMove(
        clampChatPosition(
          { x: e.clientX - drag.dx, y: e.clientY - drag.dy },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const end = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [drag, onMove]);

  const startDrag = (e: React.PointerEvent) => {
    // Buttons in the header (✕, the model dropdown) are controls, not a handle.
    if ((e.target as HTMLElement).closest('button')) return;
    setDrag({ dx: e.clientX - position.x, dy: e.clientY - position.y });
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    transport.send({ type: 'sendAgentMessage', agentId: employee.agentId, text });
    setInput('');
    onSend();
  };

  const selectModel = (model: string) => {
    transport.send({ type: 'setAgentModel', agentId: employee.agentId, model });
    setPicked(model);
    setIsModelOpen(false);
  };

  const decide = (allow: boolean) => {
    if (!permission) return;
    transport.send({
      type: 'agentPermissionDecision',
      requestId: permission.requestId,
      allow,
    });
    onDecided();
  };

  return (
    <div
      className="absolute z-20 pixel-panel p-8 flex flex-col gap-6 w-420 max-w-[45vw] h-[70vh]"
      style={{ left: position.x, top: position.y }}
      onPointerDown={onFocus}
      data-testid={`employee-chat-${employee.agentId}`}
    >
      <div
        className="relative flex items-center justify-between gap-8 cursor-move"
        onPointerDown={startDrag}
        data-testid="chat-header"
      >
        <span className="text-sm whitespace-nowrap">{employee.name}</span>
        <div className="flex items-center gap-4">
          <Button
            variant="default"
            size="sm"
            onClick={() => setIsModelOpen((v) => !v)}
            title="이 직원의 모델 바꾸기"
            data-testid="chat-model-select"
          >
            {displayModel(picked || employee.model)} ▾
          </Button>
          <span className="text-xs text-text-muted whitespace-nowrap">{employee.cwd}</span>
          <Button variant="default" size="sm" onClick={onClose} title="창 닫기">
            ✕
          </Button>
        </div>
        {isModelOpen && (
          <div className="absolute top-full right-0 pt-4 z-30">
            <div className="bg-bg border-2 border-border rounded-none shadow-pixel p-4">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => selectModel(m.id)}
                  className="block w-full text-left py-2 px-12 bg-transparent border-none rounded-none cursor-pointer whitespace-nowrap hover:bg-btn-bg"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        ref={logRef}
        className="flex-1 min-h-0 overflow-y-auto bg-bg-dark border-2 border-border rounded-none p-6 font-mono text-xs whitespace-pre-wrap break-all"
        data-testid="chat-log"
      >
        {log.length === 0 ? (
          <span className="text-text-muted">
            {`${employee.name}에게 지시하세요.\n담당 폴더: ${employee.cwd}`}
          </span>
        ) : (
          log.map((e, i) => (
            <span key={i} className={KIND_CLASS[e.kind]}>
              {e.kind === 'user'
                ? `\n> ${e.text}\n`
                : e.kind === 'tool'
                  ? `\n[도구: ${e.text}]\n`
                  : e.kind === 'system'
                    ? `\n[사무실: ${e.text}]\n`
                    : e.text}
            </span>
          ))
        )}
      </div>

      {permission && (
        <div className="border-2 border-accent-bright rounded-none p-6 flex flex-col gap-4">
          <span className="text-xs">
            {permission.title || `${employee.name}이(가) ${permission.toolName} 사용을 요청합니다`}
          </span>
          <div className="font-mono text-xs text-text-muted break-all whitespace-pre-wrap max-h-[30vh] overflow-y-auto">
            {permission.input}
          </div>
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

      {busy && !permission && (
        <div className="flex items-center gap-4 text-xs text-text-muted" data-testid="chat-busy">
          <span
            className="w-6 h-6 rounded-full shrink-0 pixel-pulse"
            style={{ background: 'var(--color-status-active)' }}
          />
          <span>{busyLabel || '생각하는 중'}…</span>
        </div>
      )}

      <div className="flex gap-4">
        <input
          className="flex-1 bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder="지시 내용 입력 후 Enter"
          data-testid="chat-input"
        />
        <Button variant="default" size="sm" onClick={send}>
          실행
        </Button>
      </div>
    </div>
  );
}
