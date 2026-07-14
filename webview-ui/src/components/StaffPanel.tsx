import { useState } from 'react';

import type { EmployeeInfo, OfficeProviderInfo } from '../hooks/useExtensionMessages.js';
import { transport } from '../transport/index.js';
import { type PickedMode, ProviderPicker } from './ProviderPicker.js';
import { Button } from './ui/Button.js';

/** Hire and fire. Hiring starts a session in the given folder and puts a
 *  character in the office; clicking that character opens their chat. An employee
 *  runs on the office's AI unless they are hired with one of their own. */

interface StaffPanelProps {
  employees: EmployeeInfo[];
  officeProvider: OfficeProviderInfo | null;
  /** Opened from the bottom toolbar, next to 꾸미기 and 설정. */
  isOpen: boolean;
  onClose: () => void;
}

/** What an employee's row says they run on. */
const MODE_LABEL: Record<string, string> = {
  subscription: '구독',
  oauthToken: 'setup-token',
  apiKey: 'API 키',
};

export function StaffPanel({ employees, officeProvider, isOpen, onClose }: StaffPanelProps) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [persona, setPersona] = useState('');
  const [isVp, setIsVp] = useState(false);
  const [mode, setMode] = useState<PickedMode>('office');
  const [secret, setSecret] = useState('');

  // Which employee's title is being edited inline, and the draft text for it.
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  // Which employee's persona panel is open, its draft text, and whether the last
  // save for that employee is still the most recent thing shown (cleared by any
  // further edit, so a stale "saved" notice can never linger past a new change).
  const [personaOpenId, setPersonaOpenId] = useState<number | null>(null);
  const [personaDraft, setPersonaDraft] = useState('');
  const [personaJustSavedId, setPersonaJustSavedId] = useState<number | null>(null);

  // Only the VP may delegate, so there is only ever one of them.
  const hasVp = employees.some((e) => e.role === 'vp');

  const hire = () => {
    if (!name.trim() || !cwd.trim()) return;
    // A key/token mode with nothing typed would hire an employee who cannot
    // authenticate — there is no stored per-employee secret to fall back on.
    if ((mode === 'apiKey' || mode === 'oauthToken') && !secret.trim()) return;

    const provider =
      mode === 'office'
        ? undefined
        : mode === 'apiKey'
          ? { mode, apiKey: secret.trim() }
          : mode === 'oauthToken'
            ? { mode, oauthToken: secret.trim() }
            : { mode };

    transport.send({
      type: 'hireEmployee',
      name: name.trim(),
      cwd: cwd.trim(),
      role: isVp && !hasVp ? 'vp' : 'staff',
      ...(provider ? { provider } : {}),
      ...(roleLabel.trim() ? { roleLabel: roleLabel.trim() } : {}),
      ...(persona.trim() ? { persona: persona.trim() } : {}),
    });
    setName('');
    setCwd('');
    setRoleLabel('');
    setPersona('');
    setIsVp(false);
    setMode('office');
    setSecret('');
  };

  const startEditingLabel = (e: EmployeeInfo) => {
    setEditingLabelId(e.agentId);
    setLabelDraft(e.roleLabel ?? '');
  };

  const saveLabel = (agentId: number) => {
    transport.send({ type: 'renameEmployee', agentId, roleLabel: labelDraft.trim() });
    setEditingLabelId(null);
  };

  const togglePersona = (e: EmployeeInfo) => {
    if (personaOpenId === e.agentId) {
      setPersonaOpenId(null);
      return;
    }
    setPersonaOpenId(e.agentId);
    setPersonaDraft(e.persona ?? '');
    setPersonaJustSavedId(null);
  };

  const savePersona = (agentId: number) => {
    transport.send({ type: 'setEmployeePersona', agentId, persona: personaDraft });
    setPersonaJustSavedId(agentId);
  };

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-60 left-10 z-30 pixel-panel p-8 flex flex-col gap-6 w-400">
      <div className="flex items-center justify-between gap-8">
        <span className="text-sm whitespace-nowrap">직원 관리</span>
        <Button variant="default" size="sm" onClick={onClose} title="닫기">
          ✕
        </Button>
      </div>

      {employees.length === 0 ? (
        <span className="text-xs text-text-muted">아직 직원이 없습니다.</span>
      ) : (
        <div className="flex flex-col gap-4">
          {employees.map((e) => (
            <div key={e.agentId} className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-8">
                <div className="flex flex-col">
                  <span className="text-xs flex items-center gap-4">
                    {e.name}
                    {editingLabelId === e.agentId ? (
                      <>
                        <input
                          className="bg-bg-dark border-2 border-border rounded-none px-4 py-2 font-mono text-2xs text-text outline-none"
                          value={labelDraft}
                          onChange={(ev) => setLabelDraft(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') saveLabel(e.agentId);
                            if (ev.key === 'Escape') setEditingLabelId(null);
                          }}
                          placeholder={e.role === 'vp' ? '부사장' : '팀원'}
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => saveLabel(e.agentId)}
                          title="저장"
                        >
                          ✓
                        </Button>
                      </>
                    ) : (
                      <>
                        {` (${e.roleLabel || (e.role === 'vp' ? '부사장' : '팀원')})`}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEditingLabel(e)}
                          title="직함 수정"
                        >
                          ✎
                        </Button>
                      </>
                    )}
                  </span>
                  <span className="font-mono text-xs text-text-muted break-all">{e.cwd}</span>
                  <span className="text-xs text-text-muted">
                    {e.authMode ? MODE_LABEL[e.authMode] : ''}
                    {e.ownProvider ? ' (직접 연결)' : ''}
                    {/* Subscription work is already paid for, so a dollar figure there
                        would be a fiction — only a key-mode employee has a bill. */}
                    {e.authMode === 'apiKey' ? ` · $${(e.costUsd ?? 0).toFixed(4)}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <Button variant="default" size="sm" onClick={() => togglePersona(e)}>
                    지침 {personaOpenId === e.agentId ? '닫기' : '보기/수정'}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => transport.send({ type: 'fireEmployee', agentId: e.agentId })}
                    title="세션 종료 후 퇴장"
                  >
                    해임
                  </Button>
                </div>
              </div>

              {personaOpenId === e.agentId && (
                <div className="flex flex-col gap-4 border-2 border-border rounded-none p-4">
                  <textarea
                    className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none resize-none"
                    rows={4}
                    value={personaDraft}
                    onChange={(ev) => {
                      setPersonaDraft(ev.target.value);
                      setPersonaJustSavedId(null);
                    }}
                    placeholder="이 직원의 역할·성격·주의사항을 적어주세요 (선택)"
                  />
                  <div className="flex items-center gap-4">
                    <Button variant="default" size="sm" onClick={() => savePersona(e.agentId)}>
                      저장
                    </Button>
                    {personaJustSavedId === e.agentId && (
                      <span className="text-2xs text-text-muted">
                        저장됨 — 이 직원을 다음에 다시 고용할 때부터 적용됩니다
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 border-t-2 border-border pt-6">
        <input
          className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름 (예: 비서)"
          data-testid="hire-name"
        />
        <input
          className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') hire();
          }}
          placeholder="담당 폴더 (예: F:\Projects\ai-office)"
          data-testid="hire-cwd"
        />
        <input
          className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
          value={roleLabel}
          onChange={(e) => setRoleLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') hire();
          }}
          placeholder="직함 (비우면 기본값: 부사장/팀원)"
          data-testid="hire-role-label"
        />
        <textarea
          className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none resize-none"
          rows={3}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="이 직원의 역할·성격·주의사항을 적어주세요 (선택)"
          data-testid="hire-persona"
        />
        {!hasVp && (
          <label className="flex items-center gap-4 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={isVp}
              onChange={(e) => setIsVp(e.target.checked)}
              data-testid="hire-vp"
            />
            부사장으로 (팀원에게 일을 시킬 수 있음)
          </label>
        )}

        <div className="flex flex-col gap-4 border-t-2 border-border pt-4">
          <span className="text-xs text-text-muted">
            AI 연결
            {officeProvider ? ` · 사무실 기본: ${MODE_LABEL[officeProvider.mode]}` : ''}
          </span>
          <ProviderPicker
            mode={mode}
            onModeChange={setMode}
            secret={secret}
            onSecretChange={setSecret}
            includeOffice
          />
        </div>

        <Button variant="default" size="sm" onClick={hire}>
          고용
        </Button>
      </div>
    </div>
  );
}
