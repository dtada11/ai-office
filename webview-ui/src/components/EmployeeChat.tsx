import { useEffect, useRef, useState } from 'react';

import type { ChatEntry, EmployeeInfo, PermissionRequest } from '../hooks/useExtensionMessages.js';
import { displayModel, MODEL_OPTIONS } from '../models.js';
import { transport } from '../transport/index.js';
import type { ChatPosition, ChatSize } from './chatWindowPosition.js';
import { clampChatPosition, clampChatSize } from './chatWindowPosition.js';
import type { ToolCategory } from './toolSummary.js';
import {
  categorizeTool,
  displayToolName,
  editDiffFields,
  formatToolInput,
  summarizeToolCall,
} from './toolSummary.js';
import { Button } from './ui/Button.js';

/** One employee's chat window — the window IS their session. Several can be open
 *  at once, which is how the user works through approvals from parallel workers.
 *  Dragged by the header, and switched to its own model there: a cheap job need
 *  not be done on an expensive model just because the office default is. */

/** How close to the bottom counts as "still following along" — inside this,
 *  new content auto-scrolls; outside it, a "새 메시지" affordance shows instead
 *  of yanking the view out from under someone reading a long result. */
const SCROLL_STICK_THRESHOLD_PX = 48;

/** Gap above a log entry: tight when it continues the same kind of entry as
 *  the one before it (e.g. two tool calls from the same turn), generous when
 *  the kind changes — that's the moment a reader needs the gap to read as
 *  "someone/something else spoke". */
const SAME_KIND_GAP = 'mt-6';
const DIFF_KIND_GAP = 'mt-20';

/** Left-border accent per tool category — read/other stay neutral so only
 *  writes (change something) and execs (run something) draw the eye. */
const CATEGORY_BORDER: Record<ToolCategory, string> = {
  read: 'border-border',
  write: 'border-accent-bright',
  exec: 'border-warning',
  delegate: 'border-accent',
  other: 'border-border',
};

interface EmployeeChatProps {
  employee: EmployeeInfo;
  log: ChatEntry[];
  /** Requests waiting on the user, oldest first. Only the front one is shown —
   *  showing all at once would eat the whole window when several stack up
   *  from a parallel tool call. */
  permissions: PermissionRequest[];
  /** Whether the employee's turn is still in progress. */
  busy: boolean;
  /** What they're doing right now, while busy. */
  busyLabel: string;
  /** Where the window sits. Owned by App, so it survives closing and re-opening. */
  position: ChatPosition;
  onMove: (position: ChatPosition) => void;
  /** Explicit size once the user has resized. Absent = default CSS sizing. */
  size?: ChatSize;
  onResize: (size: ChatSize) => void;
  /** Bring this window to the front — it is the one being worked in. */
  onFocus: () => void;
  onClose: () => void;
  onDecided: (requestId: string) => void;
  /** A message was just sent — lets the caller mark the employee busy right away. */
  onSend: () => void;
}

/** Copy-to-clipboard with inline feedback, reused by the AI-answer and
 *  tool-input blocks (G-4). Icon-sized so it reads as a control, not a word
 *  competing with the message text (H-2). `floating` pins it to the block's
 *  top-right corner and hides it until hover, for the message-flow case;
 *  the tool-detail case stays inline since that panel is already something
 *  the user opened on purpose. */
function CopyButton({
  text,
  className = '',
  floating = false,
}: {
  text: string;
  className?: string;
  floating?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        // Clipboard access can be denied by the host — nothing useful to do
        // beyond leaving the button unchanged so the user can try again.
      });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={copy}
      className={`${floating ? 'absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity' : ''} ${className}`}
      title={copied ? '복사됨' : '복사'}
    >
      {copied ? '✓' : '⧉'}
    </Button>
  );
}

/** My own instruction — right-aligned so it's found at a glance among AI
 *  replies and tool activity, which all sit on the left (G-2). */
function UserEntry({ text, spacing }: { text: string; spacing: string }) {
  return (
    <div
      className={`self-end max-w-[85%] bg-active-bg border-2 border-accent-bright px-6 py-4 text-xs whitespace-pre-wrap break-words ${spacing}`}
    >
      {text}
    </div>
  );
}

/** The employee's own words — the block that most needs to be pleasant to
 *  read, so it gets the plain pixel font (not font-mono) and generous
 *  line-height instead of the terminal look the whole log used to have.
 *  `group` + `relative` let the copy button dock to the corner and stay
 *  hidden until hover (H-2), instead of sitting as a labeled button below
 *  the text and breaking up the reading flow. */
function TextEntry({ text, spacing }: { text: string; spacing: string }) {
  return (
    <div className={`group relative self-start max-w-full ${spacing}`}>
      <div className="text-xs leading-loose whitespace-pre-wrap break-words pr-20">{text}</div>
      <CopyButton text={text} floating />
    </div>
  );
}

/** A tool call — collapsed to one line ("what did they just do") with the
 *  full input available on demand. Never trusts `input` to be clean JSON:
 *  the server truncates at 2000 chars, so summarizeToolCall/formatToolInput
 *  are the only things allowed to touch it, and both degrade instead of
 *  throwing (see toolSummary.ts). */
function ToolEntry({ entry, spacing }: { entry: ChatEntry; spacing: string }) {
  const [expanded, setExpanded] = useState(false);
  const category = categorizeTool(entry.text);
  const name = displayToolName(entry.text);
  const summary = summarizeToolCall(entry.text, entry.input);
  const detail = formatToolInput(entry.input);

  return (
    <div
      className={`self-start max-w-full border-l-2 ${CATEGORY_BORDER[category]} bg-bg-thumb pl-6 pr-4 py-4 ${spacing}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-4 w-full text-left bg-transparent border-none p-0 cursor-pointer text-2xs text-text-muted"
      >
        <span className="shrink-0">{expanded ? '▾' : '▸'}</span>
        <span className="shrink-0 font-mono">{name}</span>
        {summary !== entry.text && <span className="truncate">{summary}</span>}
      </button>
      {expanded && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="font-mono text-2xs whitespace-pre-wrap break-all max-h-[24vh] overflow-y-auto bg-bg-dark border-2 border-border p-4">
            {detail || '(입력 없음)'}
          </div>
          {detail && <CopyButton text={detail} />}
        </div>
      )}
    </div>
  );
}

/** Sufficient-permission and delegation traffic — quiet by default so it
 *  doesn't compete with the conversation, except a denial (G-6: 거부는 눈에
 *  띄게) and the "팀장 지시" tag that marks a delegated instruction apart
 *  from something the user typed themselves. */
function SystemEntry({ text, spacing }: { text: string; spacing: string }) {
  if (text === '팀장 지시') {
    return (
      <div
        className={`self-start text-2xs text-accent-bright border-2 border-accent px-4 py-1 ${spacing}`}
      >
        {text}
      </div>
    );
  }
  const isDeny = text.startsWith('거부:');
  return (
    <div
      className={`text-center text-2xs ${isDeny ? 'text-danger font-bold' : 'text-text-muted'} ${spacing}`}
    >
      {text}
    </div>
  );
}

/** Only errors reach here — the server sends nothing on a clean turn and the
 *  hook drops it, so `danger` here is already correct. Left untouched per
 *  the design brief; do not "fix" this color. */
function ResultEntry({ text, spacing }: { text: string; spacing: string }) {
  return (
    <div
      className={`self-start max-w-full border-l-2 border-danger pl-6 py-2 text-xs text-danger whitespace-pre-wrap break-words ${spacing}`}
    >
      {text}
    </div>
  );
}

export function EmployeeChat({
  employee,
  log,
  permissions,
  busy,
  busyLabel,
  position,
  onMove,
  size,
  onResize,
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
  /** Grab offset while resizing: pointer minus the size at drag start. Null = not resizing. */
  const [resizeDrag, setResizeDrag] = useState<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);
  /** Whether the user is close enough to the bottom to keep auto-scrolling.
   *  Starts true so a freshly opened window still lands on the latest message. */
  const [stickToBottom, setStickToBottom] = useState(true);
  const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Only the oldest request is shown; the rest wait behind it (I-2).
  const permission = permissions[0];
  const queuedAfter = permissions.length - 1;

  const scrollToBottom = () => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickToBottom(true);
    setHasUnseenBelow(false);
  };

  // New content: stay pinned to the bottom only if the user was already
  // there. Otherwise leave the scroll position alone and flag that there's
  // more below — a long result the user scrolled up to read should never
  // get yanked out from under them (G-4 ①).
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (stickToBottom) {
      el.scrollTop = el.scrollHeight;
    } else {
      setHasUnseenBelow(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, permission]);

  const handleLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= SCROLL_STICK_THRESHOLD_PX;
    setStickToBottom(atBottom);
    if (atBottom) setHasUnseenBelow(false);
  };

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

  // Same pattern as the drag listener above, for the resize handle.
  useEffect(() => {
    if (!resizeDrag) return;
    const move = (e: PointerEvent) => {
      onResize(
        clampChatSize(
          {
            width: resizeDrag.startW + (e.clientX - resizeDrag.startX),
            height: resizeDrag.startH + (e.clientY - resizeDrag.startY),
          },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const end = () => setResizeDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [resizeDrag, onResize]);

  const startDrag = (e: React.PointerEvent) => {
    // Buttons in the header (✕, the model dropdown) are controls, not a handle.
    if ((e.target as HTMLElement).closest('button')) return;
    setDrag({ dx: e.clientX - position.x, dy: e.clientY - position.y });
  };

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    setResizeDrag({
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
    });
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
    onDecided(permission.requestId);
  };

  const editDiff = permission ? editDiffFields(permission.toolName, permission.input) : undefined;

  return (
    <div
      ref={panelRef}
      className={`absolute z-20 pixel-panel p-8 flex flex-col gap-6 ${size ? '' : 'w-420 max-w-[45vw] h-[70vh]'}`}
      style={{
        left: position.x,
        top: position.y,
        ...(size ? { width: size.width, height: size.height } : {}),
      }}
      onPointerDown={onFocus}
      data-testid={`employee-chat-${employee.agentId}`}
    >
      <div
        className="relative flex items-center gap-8 cursor-move"
        onPointerDown={startDrag}
        data-testid="chat-header"
      >
        <div className="flex items-center gap-4 shrink-0">
          <span className="text-sm whitespace-nowrap">{employee.name}</span>
          <span className="text-2xs text-text-muted whitespace-nowrap">
            {employee.roleLabel || (employee.role === 'lead' ? '팀장' : '팀원')}
          </span>
          {employee.role === 'lead' && employee.roleLabel && (
            <span className="text-2xs text-accent-bright border-2 border-accent px-2 shrink-0">
              팀장
            </span>
          )}
        </div>
        <span
          className="flex-1 min-w-0 text-2xs text-text-muted whitespace-nowrap overflow-hidden text-ellipsis"
          title={employee.cwd}
        >
          {employee.cwd}
        </span>
        <div className="flex items-center gap-4 shrink-0">
          <Button
            variant="default"
            size="sm"
            onClick={() => setIsModelOpen((v) => !v)}
            title="이 직원의 모델 바꾸기"
            data-testid="chat-model-select"
          >
            {displayModel(picked || employee.model)} ▾
          </Button>
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

      <div className="relative flex-1 min-h-0">
        <div
          ref={logRef}
          onScroll={handleLogScroll}
          className="h-full overflow-y-auto bg-bg-dark border-2 border-border rounded-none p-6 flex flex-col"
          data-testid="chat-log"
        >
          {log.length === 0 ? (
            <div className="text-xs text-text-muted whitespace-pre-wrap">
              {`${employee.name}에게 지시하세요.\n담당 폴더: ${employee.cwd}`}
            </div>
          ) : (
            log.map((e, i) => {
              // No gap above the first entry; otherwise tight if this entry
              // continues the same kind as the one before it, generous if
              // the kind changed (H-3) — that's the reader's cue that
              // something else just spoke.
              const spacing =
                i === 0 ? '' : e.kind === log[i - 1].kind ? SAME_KIND_GAP : DIFF_KIND_GAP;
              switch (e.kind) {
                case 'user':
                  return <UserEntry key={i} text={e.text} spacing={spacing} />;
                case 'text':
                  return <TextEntry key={i} text={e.text} spacing={spacing} />;
                case 'tool':
                  return <ToolEntry key={i} entry={e} spacing={spacing} />;
                case 'system':
                  return <SystemEntry key={i} text={e.text} spacing={spacing} />;
                case 'result':
                  return <ResultEntry key={i} text={e.text} spacing={spacing} />;
              }
            })
          )}
        </div>
        {hasUnseenBelow && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-accent border-2 border-accent-bright rounded-none shadow-pixel px-8 py-2 text-2xs text-text cursor-pointer"
          >
            새 메시지 ↓
          </button>
        )}
      </div>

      {permission && (
        <div
          className="border-2 border-accent-bright rounded-none p-6 flex flex-col gap-4"
          data-testid="permission-card"
        >
          <div className="flex items-start justify-between gap-8">
            <span className="text-xs">
              {permission.title ||
                `${employee.name}이(가) ${permission.toolName} 사용을 요청합니다`}
            </span>
            {queuedAfter > 0 && (
              <span
                className="shrink-0 text-2xs text-text-muted whitespace-nowrap"
                data-testid="permission-queue-count"
              >
                대기 {queuedAfter}건
              </span>
            )}
          </div>
          <span className="text-2xs text-text-muted font-mono break-words">
            {summarizeToolCall(permission.toolName, permission.input)}
          </span>
          {editDiff ? (
            <div className="flex flex-col gap-4 max-h-[30vh] overflow-y-auto">
              <div className="border-l-2 border-danger pl-4 flex flex-col gap-2">
                <span className="text-2xs text-text-muted">이전</span>
                <div className="font-mono text-2xs whitespace-pre-wrap break-all">
                  {editDiff.oldString}
                </div>
              </div>
              <div className="border-l-2 border-status-success pl-4 flex flex-col gap-2">
                <span className="text-2xs text-text-muted">이후</span>
                <div className="font-mono text-2xs whitespace-pre-wrap break-all">
                  {editDiff.newString}
                </div>
              </div>
            </div>
          ) : (
            <div className="font-mono text-2xs text-text-muted whitespace-pre-wrap break-all max-h-[30vh] overflow-y-auto">
              {formatToolInput(permission.input)}
            </div>
          )}
          <div className="flex items-center gap-16 pt-2">
            <Button variant="default" size="sm" onClick={() => decide(true)}>
              허용
            </Button>
            <Button
              variant="default"
              size="sm"
              className="border-danger! text-danger! hover:bg-danger! hover:text-text!"
              onClick={() => decide(false)}
            >
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
          className="flex-1 bg-bg-dark border-2 border-border rounded-none px-6 py-4 text-xs text-text outline-none"
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

      <div
        className="absolute right-0 bottom-0 w-14 h-14 cursor-nwse-resize"
        onPointerDown={startResize}
        title="창 크기 조절"
        data-testid="chat-resize-handle"
      >
        <div className="absolute right-2 bottom-2 w-6 h-6 border-r-2 border-b-2 border-text-muted" />
      </div>
    </div>
  );
}
