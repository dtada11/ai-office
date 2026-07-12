import { useEffect, useRef, useState } from 'react';

import type { ChatEntry, EmployeeInfo, PermissionRequest } from '../hooks/useExtensionMessages.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';

/** One employee's chat window — the window IS their session. Several can be open
 *  at once, which is how the user works through approvals from parallel workers. */

const KIND_CLASS: Record<ChatEntry['kind'], string> = {
  user: 'text-accent-bright',
  text: 'text-text',
  tool: 'text-text-muted',
  result: 'text-red-400',
};

interface EmployeeChatProps {
  employee: EmployeeInfo;
  log: ChatEntry[];
  permission?: PermissionRequest;
  /** Window index — windows are staggered so several stay readable at once. */
  index: number;
  onClose: () => void;
  onDecided: () => void;
}

export function EmployeeChat({
  employee,
  log,
  permission,
  index,
  onClose,
  onDecided,
}: EmployeeChatProps) {
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, permission]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    transport.send({ type: 'sendAgentMessage', agentId: employee.agentId, text });
    setInput('');
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
      className="absolute top-10 z-20 pixel-panel p-8 flex flex-col gap-6 w-420 max-w-[45vw] h-[70vh]"
      style={{ left: 40 + index * 40 }}
      data-testid={`employee-chat-${employee.agentId}`}
    >
      <div className="flex items-center justify-between gap-8">
        <span className="text-sm whitespace-nowrap">{employee.name}</span>
        <div className="flex items-center gap-4">
          <span className="text-xs text-text-muted whitespace-nowrap">{employee.cwd}</span>
          <Button variant="default" size="sm" onClick={onClose} title="창 닫기">
            ✕
          </Button>
        </div>
      </div>

      <div
        ref={logRef}
        className="flex-1 overflow-y-auto bg-bg-dark border-2 border-border rounded-none p-6 font-mono text-xs whitespace-pre-wrap break-all"
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
