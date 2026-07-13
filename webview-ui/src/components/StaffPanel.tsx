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
}

/** What an employee's row says they run on. */
const MODE_LABEL: Record<string, string> = {
  subscription: '구독',
  oauthToken: 'setup-token',
  apiKey: 'API 키',
};

export function StaffPanel({ employees, officeProvider }: StaffPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [isVp, setIsVp] = useState(false);
  const [mode, setMode] = useState<PickedMode>('office');
  const [secret, setSecret] = useState('');

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
    });
    setName('');
    setCwd('');
    setIsVp(false);
    setMode('office');
    setSecret('');
  };

  if (!isOpen) {
    return (
      <div className="absolute bottom-60 left-10 z-30">
        <Button variant="default" onClick={() => setIsOpen(true)} title="직원 고용·해임">
          직원 관리
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-60 left-10 z-30 pixel-panel p-8 flex flex-col gap-6 w-400">
      <div className="flex items-center justify-between gap-8">
        <span className="text-sm whitespace-nowrap">직원 관리</span>
        <Button variant="default" size="sm" onClick={() => setIsOpen(false)} title="닫기">
          ✕
        </Button>
      </div>

      {employees.length === 0 ? (
        <span className="text-xs text-text-muted">아직 직원이 없습니다.</span>
      ) : (
        <div className="flex flex-col gap-4">
          {employees.map((e) => (
            <div key={e.agentId} className="flex items-center justify-between gap-8">
              <div className="flex flex-col">
                <span className="text-xs">
                  {e.name}
                  {e.role === 'vp' ? ' (부사장)' : ''}
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
              <Button
                variant="default"
                size="sm"
                onClick={() => transport.send({ type: 'fireEmployee', agentId: e.agentId })}
                title="세션 종료 후 퇴장"
              >
                해임
              </Button>
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
