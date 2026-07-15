import { useState } from 'react';

import type { EmployeeInfo, OfficeProviderInfo } from '../hooks/useExtensionMessages.js';
import { applyJobPreset, JOB_PRESETS } from '../jobPresets.js';
import { MODEL_OPTIONS } from '../models.js';
import { transport } from '../transport/index.js';
import { FolderPicker } from './FolderPicker.js';
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
  /** Open (or focus, if already open) that employee's persona editor window. */
  onOpenPersona: (agentId: number) => void;
}

type StaffTabId = 'roster' | 'hire';

/** Adding a tab later is one entry here (plus its content block below) — no
 *  router or tab-context library, there are only ever a couple of these. */
const STAFF_TABS: { id: StaffTabId; label: string }[] = [
  { id: 'roster', label: '직원 목록' },
  { id: 'hire', label: '새 직원 고용' },
];

/** What an employee's row says they run on. */
const MODE_LABEL: Record<string, string> = {
  subscription: '구독',
  apiKey: 'API 키',
};

/** Duty status: filled dot = present, hollow dot = away, pulsing amber = mid-handoff.
 *  Color alone would not survive a glance at the muted-text row below it, so on/off
 *  is also filled-vs-hollow, and a text label spells it out — no hover required.
 *  Follows EmployeeChat.tsx's busy indicator (dot + label, own line, gap-4). */
function DutyStatus({ duty }: { duty: EmployeeInfo['duty'] }) {
  const { dotClass, textClass, label } =
    duty === 'clockingOut'
      ? {
          dotClass: 'bg-status-permission pixel-pulse',
          textClass: 'text-status-permission',
          label: '퇴근 처리 중',
        }
      : duty === 'on'
        ? { dotClass: 'bg-status-success', textClass: 'text-status-success', label: '근무 중' }
        : { dotClass: 'border-2 border-border', textClass: 'text-text-muted', label: '퇴근함' };

  return (
    <div className="flex items-center gap-4">
      <span className={`w-6 h-6 rounded-full shrink-0 ${dotClass}`} />
      <span className={`text-2xs whitespace-nowrap ${textClass}`}>{label}</span>
    </div>
  );
}

interface EmployeeRowProps {
  employee: EmployeeInfo;
  isEditingLabel: boolean;
  labelDraft: string;
  onLabelDraftChange: (value: string) => void;
  onStartEditingLabel: () => void;
  onSaveLabel: () => void;
  onCancelEditingLabel: () => void;
  onOpenPersona: () => void;
}

function EmployeeRow({
  employee: e,
  isEditingLabel,
  labelDraft,
  onLabelDraftChange,
  onStartEditingLabel,
  onSaveLabel,
  onCancelEditingLabel,
  onOpenPersona,
}: EmployeeRowProps) {
  return (
    <div
      className={`flex items-start justify-between gap-8 p-6 border-2 border-border bg-bg-dark ${
        e.duty === 'off' ? 'text-text-muted' : ''
      }`}
      data-testid={`employee-row-${e.agentId}`}
    >
      <div className="flex flex-col min-w-0 gap-2">
        <DutyStatus duty={e.duty} />
        <span className="text-xs font-bold flex items-center gap-4 flex-wrap">
          {e.name}
          {isEditingLabel ? (
            <>
              <input
                className="bg-bg-dark border-2 border-border rounded-none px-4 py-2 font-mono text-2xs font-normal text-text outline-none"
                value={labelDraft}
                onChange={(ev) => onLabelDraftChange(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') onSaveLabel();
                  if (ev.key === 'Escape') onCancelEditingLabel();
                }}
                placeholder={e.role === 'lead' ? '팀장' : '팀원'}
                autoFocus
              />
              <Button variant="ghost" size="icon" onClick={onSaveLabel} title="저장">
                ✓
              </Button>
            </>
          ) : (
            <>
              <span className="font-normal text-text-muted">
                ({e.roleLabel || (e.role === 'lead' ? '팀장' : '팀원')})
              </span>
              <Button variant="ghost" size="icon" onClick={onStartEditingLabel} title="직함 수정">
                ✎
              </Button>
            </>
          )}
        </span>
        <span
          className="font-mono text-2xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap block"
          title={e.cwd}
        >
          {e.cwd}
        </span>
        <span className="text-2xs text-text-muted">
          {e.authMode ? MODE_LABEL[e.authMode] : ''}
          {e.ownProvider ? ' (직접 연결)' : ''}
          {/* Subscription work is already paid for, so a dollar figure there
              would be a fiction — only a key-mode employee has a bill. */}
          {e.authMode === 'apiKey' ? ` · $${(e.costUsd ?? 0).toFixed(4)}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <Button variant="default" size="sm" onClick={onOpenPersona} title="지침 보기/수정">
          지침
        </Button>
        <Button
          variant={e.duty === 'clockingOut' ? 'disabled' : e.duty === 'on' ? 'active' : 'default'}
          size="sm"
          disabled={e.duty === 'clockingOut'}
          onClick={() =>
            transport.send({
              type: e.duty === 'on' ? 'clockOut' : 'clockIn',
              agentId: e.agentId,
            })
          }
          title={e.duty === 'on' ? '업무를 남기고 퇴근' : '노트를 읽고 출근'}
        >
          {e.duty === 'clockingOut' ? '퇴근 중…' : e.duty === 'on' ? '퇴근' : '출근'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="hover:text-danger!"
          onClick={() => transport.send({ type: 'fireEmployee', agentId: e.agentId })}
          title="세션 종료 후 퇴장"
        >
          해임
        </Button>
      </div>
    </div>
  );
}

export function StaffPanel({
  employees,
  officeProvider,
  isOpen,
  onClose,
  onOpenPersona,
}: StaffPanelProps) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [jobId, setJobId] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [persona, setPersona] = useState('');
  const [hireModel, setHireModel] = useState('');
  const [isLead, setIsLead] = useState(false);
  const [mode, setMode] = useState<PickedMode>('office');
  const [secret, setSecret] = useState('');
  const [activeTab, setActiveTab] = useState<StaffTabId>('roster');
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);

  // Which employee's title is being edited inline, and the draft text for it.
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  // Only the lead may delegate, so there is only ever one of them.
  const hasLead = employees.some((e) => e.role === 'lead');

  // Picking a job overwrites the title/instructions/model drafts with that
  // preset's values — simple, not merged. The user can still edit any of them
  // by hand afterward; picking a job again overwrites again.
  const handleJobChange = (id: string) => {
    setJobId(id);
    const fields = applyJobPreset(id);
    if (!fields) return;
    setRoleLabel(fields.roleLabel);
    setPersona(fields.persona);
    setHireModel(fields.model);
  };

  const hire = () => {
    if (!name.trim() || !cwd.trim()) return;
    // A key mode with nothing typed would hire an employee who cannot
    // authenticate — there is no stored per-employee secret to fall back on.
    if (mode === 'apiKey' && !secret.trim()) return;

    const provider =
      mode === 'office'
        ? undefined
        : mode === 'apiKey'
          ? { mode, apiKey: secret.trim() }
          : { mode };

    transport.send({
      type: 'hireEmployee',
      name: name.trim(),
      cwd: cwd.trim(),
      role: isLead && !hasLead ? 'lead' : 'staff',
      ...(provider ? { provider } : {}),
      ...(roleLabel.trim() ? { roleLabel: roleLabel.trim() } : {}),
      ...(persona.trim() ? { persona: persona.trim() } : {}),
      ...(hireModel ? { model: hireModel } : {}),
    });
    setName('');
    setCwd('');
    setJobId('');
    setRoleLabel('');
    setPersona('');
    setHireModel('');
    setIsLead(false);
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

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-60 left-10 z-30 pixel-panel p-8 flex flex-col gap-6 w-400 max-h-[calc(100vh-80px)] overflow-y-auto">
      <div className="flex items-center justify-between gap-8">
        <span className="text-sm whitespace-nowrap">직원 관리</span>
        <Button variant="default" size="sm" onClick={onClose} title="닫기">
          ✕
        </Button>
      </div>

      <div className="flex items-center gap-4 border-b-2 border-border pb-6">
        {STAFF_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'active' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            data-testid={`staff-tab-${tab.id}`}
          >
            {tab.id === 'roster' ? `${tab.label} (${employees.length})` : tab.label}
          </Button>
        ))}
      </div>

      {activeTab === 'roster' &&
        (employees.length === 0 ? (
          <span className="text-xs text-text-muted">아직 직원이 없습니다.</span>
        ) : (
          <div className="flex flex-col gap-4">
            {employees.map((e) => (
              <EmployeeRow
                key={e.agentId}
                employee={e}
                isEditingLabel={editingLabelId === e.agentId}
                labelDraft={labelDraft}
                onLabelDraftChange={setLabelDraft}
                onStartEditingLabel={() => startEditingLabel(e)}
                onSaveLabel={() => saveLabel(e.agentId)}
                onCancelEditingLabel={() => setEditingLabelId(null)}
                onOpenPersona={() => onOpenPersona(e.agentId)}
              />
            ))}
          </div>
        ))}

      {activeTab === 'hire' && (
        <div className="flex flex-col gap-4">
          <input
            className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름 (예: 비서)"
            data-testid="hire-name"
          />
          <div className="flex gap-2">
            <input
              className="flex-1 min-w-0 bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') hire();
              }}
              placeholder="담당 폴더 (절대 경로, 예: C:\Users\me\projects\my-app)"
              data-testid="hire-cwd"
            />
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsFolderPickerOpen(true)}
              data-testid="hire-cwd-browse"
            >
              불러오기
            </Button>
          </div>
          <select
            className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
            value={jobId}
            onChange={(e) => handleJobChange(e.target.value)}
            title="직무를 고르면 아래 직함·지침·모델이 채워집니다. 고른 뒤에도 자유롭게 고칠 수 있습니다."
            data-testid="hire-job"
          >
            <option value="">직무 선택 안 함</option>
            {JOB_PRESETS.map((job) => (
              <option key={job.id} value={job.id}>
                {job.label}
              </option>
            ))}
          </select>
          <input
            className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
            value={roleLabel}
            onChange={(e) => setRoleLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') hire();
            }}
            placeholder="직함 (비우면 기본값: 팀장/팀원)"
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
          <select
            className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
            value={hireModel}
            onChange={(e) => setHireModel(e.target.value)}
            title="이 모델로 고용됩니다. 비우면 사무실 기본 모델을 씁니다."
            data-testid="hire-model"
          >
            <option value="">모델 추천 없음</option>
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {!hasLead && (
            <label className="flex items-center gap-4 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={isLead}
                onChange={(e) => setIsLead(e.target.checked)}
                data-testid="hire-lead"
              />
              팀장으로 (팀원에게 일을 시킬 수 있음)
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
      )}

      <FolderPicker
        isOpen={isFolderPickerOpen}
        onClose={() => setIsFolderPickerOpen(false)}
        onSelect={setCwd}
      />
    </div>
  );
}
