import { useState } from 'react';

import { findTeamTemplate, TEAM_TEMPLATES } from '../../../core/src/teamTemplates.js';
import type {
  EmployeeInfo,
  HandoffNotesInfo,
  OfficeProviderInfo,
} from '../hooks/useExtensionMessages.js';
import { applyJobPreset, JOB_PRESETS } from '../jobPresets.js';
import { MODEL_OPTIONS } from '../models.js';
import { buildScaffoldPreview } from '../teamScaffoldPreview.js';
import { transport } from '../transport/index.js';
import { FolderPicker } from './FolderPicker.js';
import { HandoffNotePicker } from './HandoffNotePicker.js';
import { type PickedMode, ProviderPicker } from './ProviderPicker.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

/** One suggested hire the scaffold API proposes for a role, already in the
 *  hire form's field shape. Re-declared here (rather than imported from the
 *  server) the same way folderPicker.ts re-declares DirListing/DirEntry --
 *  the webview only trusts what comes back over the wire from
 *  POST /api/scaffold-team (server/src/teamScaffold.ts), it never imports
 *  server code. */
interface ScaffoldRosterEntry {
  defaultName: string;
  org: 'lead' | 'staff';
  cwd: string;
  roleLabel: string;
  persona: string;
  model: string;
}

/** Wire shape of POST /api/scaffold-team's response. */
type ScaffoldApiResult =
  | { ok: true; projectDir: string; createdDirs: string[]; roster: ScaffoldRosterEntry[] }
  | { ok: false; error: string };

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
  /** Answer to the last listHandoffNotes, for offering "resume from" choices
   *  in the hire form. */
  handoffNotes: HandoffNotesInfo | null;
}

type StaffTabId = 'roster' | 'hire' | 'scaffold';

/** Adding a tab later is one entry here (plus its content block below) — no
 *  router or tab-context library, there are only ever a couple of these.
 *  Labels stay short on purpose: the panel is a fixed w-400 and "직원 관리"
 *  above already sets the context, so "목록/고용" read fine without a
 *  restated "직원" prefix. All three plus the roster count still have to
 *  fit on one line at once -- that's the whole reason they're this short. */
const STAFF_TABS: { id: StaffTabId; label: string }[] = [
  { id: 'roster', label: '목록' },
  { id: 'hire', label: '고용' },
  { id: 'scaffold', label: '팀 프로젝트' },
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
  /** Opens the keep/delete confirm instead of firing immediately (see
   *  fireConfirm state in StaffPanel). */
  onRequestFire: () => void;
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
  onRequestFire,
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
          onClick={onRequestFire}
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
  handoffNotes,
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
  // '' = "없음 (새로 시작)" — the default, plain first-shift hire.
  const [handoffFromKey, setHandoffFromKey] = useState('');

  // Which employee's title is being edited inline, and the draft text for it.
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  // Set on 해임 click, cleared on either confirm choice or the modal's own
  // close -- the actual fireEmployee send waits for keep/delete, so a stray
  // click never ends a session before the user has chosen what happens to
  // its notes.
  const [fireTarget, setFireTarget] = useState<{ agentId: number; name: string } | null>(null);

  // "팀 프로젝트 만들기" tab state. Preview is derived (pure, no fetch) from
  // these on every render; only createScaffold() below touches the network.
  const [templateKey, setTemplateKey] = useState(TEAM_TEMPLATES[0]?.key ?? '');
  const [scaffoldBaseDir, setScaffoldBaseDir] = useState('');
  const [projectName, setProjectName] = useState('');
  const [isScaffoldPickerOpen, setIsScaffoldPickerOpen] = useState(false);
  const [scaffoldLoading, setScaffoldLoading] = useState(false);
  const [scaffoldError, setScaffoldError] = useState('');
  // Non-null once the folders exist -- the suggested roster the user can
  // pick from to prefill the hire form. Hiring itself still requires the
  // explicit 고용 click; nothing here starts a session.
  const [scaffoldRoster, setScaffoldRoster] = useState<ScaffoldRosterEntry[] | null>(null);

  // Only the lead may delegate, so there is only ever one of them.
  const hasLead = employees.some((e) => e.role === 'lead');

  // UX-preemptive only — the server is the true gate (office-wide, on/off
  // duty, any cwd), since it's also the one guarding rehireSavedEmployees'
  // own roster. This just keeps the button from looking clickable when it
  // would only bounce off an officeNotice.
  const nameTaken = name.trim() !== '' && employees.some((e) => e.name === name.trim());

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

  // The hire form's cwd is what decides which folder's notes could be resumed
  // from — ask the server once it's set (typing further resets the pick below
  // via handleCwdChange, so a stale key never rides along to a different cwd).
  const requestHandoffNotes = (path: string) => {
    if (path.trim()) transport.send({ type: 'listHandoffNotes', cwd: path.trim() });
  };

  const handleCwdChange = (value: string) => {
    setCwd(value);
    setHandoffFromKey('');
  };

  const hire = () => {
    if (!name.trim() || !cwd.trim() || nameTaken) return;
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
      ...(handoffFromKey ? { handoffFromKey } : {}),
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
    setHandoffFromKey('');
  };

  const startEditingLabel = (e: EmployeeInfo) => {
    setEditingLabelId(e.agentId);
    setLabelDraft(e.roleLabel ?? '');
  };

  const saveLabel = (agentId: number) => {
    transport.send({ type: 'renameEmployee', agentId, roleLabel: labelDraft.trim() });
    setEditingLabelId(null);
  };

  // Mirrors the guard inside hire() itself -- surfaced here so the button can
  // look disabled instead of silently doing nothing when required fields (or,
  // in key mode, the key) are missing -- or the name is already taken.
  const hireReady =
    name.trim() !== '' &&
    cwd.trim() !== '' &&
    !nameTaken &&
    (mode !== 'apiKey' || secret.trim() !== '');

  const selectedTemplate = findTeamTemplate(templateKey);
  const scaffoldPreview = selectedTemplate
    ? buildScaffoldPreview(selectedTemplate, scaffoldBaseDir, projectName)
    : null;

  // Only fires on the explicit "만들기" click -- nothing before this touches
  // disk, and this alone doesn't hire anyone either. It just creates folders
  // and hands back a suggested roster for the hire form below.
  const createScaffold = () => {
    if (!selectedTemplate || !scaffoldPreview) return;
    setScaffoldLoading(true);
    setScaffoldError('');
    fetch('/api/scaffold-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateKey: selectedTemplate.key,
        baseDir: scaffoldBaseDir.trim(),
        projectName: projectName.trim(),
      }),
    })
      .then((res) => res.json() as Promise<ScaffoldApiResult>)
      .then((result) => {
        if (result.ok) {
          setScaffoldRoster(result.roster);
        } else {
          setScaffoldError(result.error);
        }
      })
      .catch(() => setScaffoldError('요청에 실패했습니다.'))
      .finally(() => setScaffoldLoading(false));
  };

  // Copies one suggested hire into the hire form and switches to it for
  // review -- the user still has to press 고용 themselves; this never opens
  // a session on its own.
  const fillFromRosterEntry = (entry: ScaffoldRosterEntry) => {
    setName(entry.defaultName);
    setCwd(entry.cwd);
    setJobId('');
    setRoleLabel(entry.roleLabel);
    setPersona(entry.persona);
    setHireModel(entry.model);
    setIsLead(entry.org === 'lead' && !hasLead);
    setHandoffFromKey('');
    requestHandoffNotes(entry.cwd);
    setActiveTab('hire');
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
            className="whitespace-nowrap"
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
                onRequestFire={() => setFireTarget({ agentId: e.agentId, name: e.name })}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') hire();
            }}
            placeholder="이름 (필수 · 예: 비서)"
            data-testid="hire-name"
          />
          {nameTaken && (
            <span className="text-2xs text-status-error" data-testid="hire-name-taken">
              이미 있는 이름입니다.
            </span>
          )}
          <div className="flex gap-2">
            <input
              className="flex-1 min-w-0 bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
              value={cwd}
              onChange={(e) => handleCwdChange(e.target.value)}
              onBlur={(e) => requestHandoffNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') hire();
              }}
              placeholder="담당 폴더 (필수 · 절대 경로, 예: C:\Users\me\projects\my-app)"
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
          <HandoffNotePicker
            cwd={cwd}
            handoffNotes={handoffNotes}
            value={handoffFromKey}
            onChange={setHandoffFromKey}
            groupName="staff-hire-handoff"
          />
          <div className="flex flex-col gap-2">
            <span className="text-2xs text-text-muted">
              직무 프리셋 (선택 · 고르면 아래 직함·지침·모델이 채워져요)
            </span>
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
          </div>
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

          <Button
            variant={hireReady ? 'accent' : 'disabled'}
            size="sm"
            disabled={!hireReady}
            onClick={hire}
            data-testid="hire-submit"
          >
            고용
          </Button>
        </div>
      )}

      {activeTab === 'scaffold' && (
        <div className="flex flex-col gap-4">
          <select
            className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
            value={templateKey}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              setScaffoldRoster(null);
              setScaffoldError('');
            }}
            title="폴더 구조와 팀 구성이 이 템플릿에 따라 만들어집니다."
            data-testid="scaffold-template"
          >
            {TEAM_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <input
              className="flex-1 min-w-0 bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
              value={scaffoldBaseDir}
              onChange={(e) => setScaffoldBaseDir(e.target.value)}
              placeholder="베이스 폴더 (절대 경로) — 여기에 프로젝트 폴더를 만듭니다"
              data-testid="scaffold-basedir"
            />
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsScaffoldPickerOpen(true)}
              data-testid="scaffold-basedir-browse"
            >
              불러오기
            </Button>
          </div>

          <input
            className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="프로젝트 이름 (예: my-app)"
            data-testid="scaffold-project-name"
          />

          {scaffoldPreview && (
            <div
              className="flex flex-col gap-2 border-2 border-border p-6 bg-bg-dark"
              data-testid="scaffold-preview"
            >
              <span className="text-2xs text-text-muted">만들어질 폴더</span>
              {scaffoldPreview.dirs.map((d) => (
                <span
                  key={d}
                  className="font-mono text-2xs overflow-hidden text-ellipsis whitespace-nowrap"
                  title={d}
                >
                  {d}
                </span>
              ))}
              <span className="text-2xs text-text-muted mt-4">팀 구성</span>
              {scaffoldPreview.roster.map((r) => (
                <span
                  key={r.cwd}
                  className="text-2xs overflow-hidden text-ellipsis whitespace-nowrap"
                  title={`${r.roleLabel} (${r.org === 'lead' ? '팀장' : '팀원'}) — ${r.cwd}`}
                >
                  {r.roleLabel} ({r.org === 'lead' ? '팀장' : '팀원'}) — {r.cwd}
                </span>
              ))}
            </div>
          )}

          {scaffoldError && (
            <div className="flex items-center gap-4" data-testid="scaffold-error">
              <span className="w-6 h-6 rounded-full shrink-0 bg-status-permission" />
              <span className="text-2xs text-status-permission">{scaffoldError}</span>
            </div>
          )}

          <Button
            variant={!scaffoldPreview || scaffoldLoading ? 'disabled' : 'accent'}
            size="sm"
            disabled={!scaffoldPreview || scaffoldLoading}
            onClick={createScaffold}
            data-testid="scaffold-create"
          >
            {scaffoldLoading ? '만드는 중…' : '만들기'}
          </Button>

          {scaffoldRoster && (
            <div className="flex flex-col gap-2 border-t-2 border-border pt-4">
              <span className="text-xs text-text-muted">
                생성 완료 — 아래에서 고용 폼에 채운 뒤 검토하고 고용하세요.
              </span>
              {scaffoldRoster.map((entry, i) => (
                <div
                  key={`${entry.cwd}-${i}`}
                  className="flex items-center justify-between gap-4 border-2 border-border p-4"
                  data-testid={`scaffold-roster-entry-${i}`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs">{entry.roleLabel}</span>
                    <span
                      className="font-mono text-2xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
                      title={entry.cwd}
                    >
                      {entry.cwd}
                    </span>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => fillFromRosterEntry(entry)}
                    data-testid={`scaffold-fill-${i}`}
                  >
                    고용 폼에 채우기
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <FolderPicker
        isOpen={isFolderPickerOpen}
        onClose={() => setIsFolderPickerOpen(false)}
        onSelect={(path) => {
          handleCwdChange(path);
          requestHandoffNotes(path);
        }}
      />
      <FolderPicker
        isOpen={isScaffoldPickerOpen}
        onClose={() => setIsScaffoldPickerOpen(false)}
        onSelect={setScaffoldBaseDir}
      />

      <Modal
        isOpen={fireTarget !== null}
        onClose={() => setFireTarget(null)}
        title="해임 확인"
        zIndex={55}
      >
        <div className="flex flex-col gap-8 px-10 pb-6 min-w-sm">
          <span className="text-sm text-text-muted">
            {fireTarget?.name}의 인수인계 기록을 어떻게 할까요?
          </span>
          <div className="flex gap-4">
            <Button
              variant="accent"
              size="sm"
              onClick={() => {
                if (!fireTarget) return;
                transport.send({
                  type: 'fireEmployee',
                  agentId: fireTarget.agentId,
                  deleteHandoff: false,
                });
                setFireTarget(null);
              }}
              data-testid="fire-confirm-keep"
            >
              남기기
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hover:text-danger!"
              onClick={() => {
                if (!fireTarget) return;
                transport.send({
                  type: 'fireEmployee',
                  agentId: fireTarget.agentId,
                  deleteHandoff: true,
                });
                setFireTarget(null);
              }}
              data-testid="fire-confirm-delete"
            >
              삭제하고 해임
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
