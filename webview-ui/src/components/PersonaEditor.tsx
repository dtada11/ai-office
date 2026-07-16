import { useEffect, useRef, useState } from 'react';

import type { EmployeeInfo } from '../hooks/useExtensionMessages.js';
import { transport } from '../transport/index.js';
import type { ChatPosition } from './chatWindowPosition.js';
import { clampChatPosition } from './chatWindowPosition.js';
import { Button } from './ui/Button.js';

/** One employee's persona editor — a floating window separate from the staff
 *  panel, so closing it (its own ✕) never takes the roster panel down with it.
 *  Follows EmployeeChat.tsx's window shell: position owned by App, dragged by
 *  the header, listeners on window (not the header) for the same reason
 *  EmployeeChat.tsx does — bringing the window to front re-orders the DOM,
 *  which would drop a pointer capture held by the header. */

interface PersonaEditorProps {
  employee: EmployeeInfo;
  position: ChatPosition;
  onMove: (position: ChatPosition) => void;
  onFocus: () => void;
  onClose: () => void;
}

export function PersonaEditor({
  employee,
  position,
  onMove,
  onFocus,
  onClose,
}: PersonaEditorProps) {
  const [personaDraft, setPersonaDraft] = useState(employee.persona ?? '');
  const [justSaved, setJustSaved] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  /** Persona value we last asked the server to save — set in save(), cleared
   *  once reconciled below. Lets a fresh roster snapshot tell "confirmed"
   *  (matches — leave 저장됨 up) apart from "didn't stick" (doesn't match —
   *  a save that silently failed to persist would otherwise show 저장됨
   *  forever, with nothing to ever contradict it). Null = no save in flight
   *  to reconcile against. */
  const lastSavedPersonaRef = useRef<string | null>(null);

  // Every employeeState broadcast hands back a freshly-parsed `employee`
  // object even when nothing about this employee changed (the whole roster
  // is rebuilt off the wire each time), so this fires on any update, not
  // just a persona change — including the confirmation setEmployeePersona
  // itself triggers right after saving. On the common success path the
  // persona already matches what we sent, so this is a no-op and 저장됨
  // stays up exactly as before; it only reacts when a fresh snapshot
  // disagrees with what we thought we'd saved.
  useEffect(() => {
    if (lastSavedPersonaRef.current === null) return;
    if (employee.persona !== lastSavedPersonaRef.current) {
      setJustSaved(false);
      lastSavedPersonaRef.current = null;
    }
  }, [employee]);

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
    if ((e.target as HTMLElement).closest('button')) return;
    setDrag({ dx: e.clientX - position.x, dy: e.clientY - position.y });
  };

  const save = () => {
    transport.send({
      type: 'setEmployeePersona',
      agentId: employee.agentId,
      persona: personaDraft,
    });
    setJustSaved(true);
    lastSavedPersonaRef.current = personaDraft;
  };

  return (
    <div
      className="absolute z-20 pixel-panel p-8 flex flex-col gap-6 w-400"
      style={{ left: position.x, top: position.y }}
      onPointerDown={onFocus}
      data-testid={`persona-editor-${employee.agentId}`}
    >
      <div
        className="flex items-center justify-between gap-8 cursor-move"
        onPointerDown={startDrag}
        data-testid="persona-editor-header"
      >
        <span className="text-sm whitespace-nowrap">{employee.name} 지침</span>
        <Button variant="default" size="sm" onClick={onClose} title="닫기">
          ✕
        </Button>
      </div>

      <textarea
        className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none resize-none"
        rows={4}
        value={personaDraft}
        onChange={(e) => {
          setPersonaDraft(e.target.value);
          setJustSaved(false);
        }}
        placeholder="이 직원의 역할·성격·주의사항을 적어주세요 (선택)"
      />
      <div className="flex items-center gap-4">
        <Button variant="default" size="sm" onClick={save}>
          저장
        </Button>
        {justSaved && (
          <span className="text-2xs text-text-muted">
            저장됨 — 이 직원을 다음에 다시 고용할 때부터 적용됩니다
          </span>
        )}
      </div>
    </div>
  );
}
