/**
 * Employee registry — the office's staff.
 *
 * One employee = one session + one office character, both keyed by the same
 * agentId. The character is created by us at hire time (we never register the
 * folder for scanning — that is what would drag the user's own terminal
 * sessions into the office), and the session's id is bound to it as soon as the
 * session reports one.
 *
 * Scope/safety: standalone mode only (server binds to 127.0.0.1). Permission
 * mode stays at the SDK default — every tool call that needs approval goes
 * through askPermission, which asks the webview and waits.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { EmployeeDuty, EmployeeProvider, EmployeeRole } from '../../core/src/messages.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { resolveProvider } from './aiProvider.js';
import {
  ClaudeEmployee,
  type Delegation,
  type Employee,
  type EmployeeEvent,
  type PermissionAsk,
} from './employee.js';
import { readEmployees, type SavedEmployee, writeEmployees } from './employeePersistence.js';
import type { AgentState } from './types.js';

/** How long a permission request waits for the user before being denied. */
const PERMISSION_TIMEOUT_MS = 30 * 60 * 1000;

/** How long the VP waits for a team member before giving up on that delegation. */
const DELEGATION_TIMEOUT_MS = 15 * 60 * 1000;

/** How long clockOut() waits for the handoff summary before giving up and
 *  clocking out without a note. */
const HANDOFF_SUMMARY_TIMEOUT_MS = 5 * 60 * 1000;

/** Handoff notes kept per employee, oldest deleted first past this count. */
const MAX_HANDOFF_NOTES = 10;

const HANDOFF_SUMMARY_PROMPT = `지금 퇴근합니다. 다음 근무자에게 남길 인수인계 노트를 아래 세 항목으로 마크다운으로 작성해서, 답변 텍스트로만 알려주세요(파일을 만들지 마세요):

1. 이번 근무에서 완료한 일
2. 진행 중인 일과 현재 상태 (어디까지 했고 다음 단계는 무엇인지)
3. 다음 근무자가 알아야 할 것 (주의점·결정사항·막힌 지점)`;

interface Staff {
  /** Absent only when `duty` is 'off' — a clocked-out employee has no live session. */
  employee?: Employee;
  name: string;
  cwd: string;
  role: EmployeeRole;
  /** What they are called on screen. The office names its own jobs; `role` is still
   *  what decides what they may do. Unset = the default label for their role. */
  roleLabel?: string;
  /** Their standing instructions, folded into the session's system prompt when it
   *  starts. Changing it here does not reach a session already running. */
  persona?: string;
  model: string;
  contextTokens: number;
  contextLimit: number;
  /** Their own AI, if they overrode the office default. Kept as given (secret and
   *  all) because it has to be written back to the roster to survive a restart. */
  ownProvider?: EmployeeProvider;
  /** The provider actually in force — own, or the office default at hire time. */
  provider: EmployeeProvider;
  /** What this session has cost so far, as the SDK reckons it. Note it is NOT zero
   *  on a subscription — the SDK still prices the work — so it is only shown for an
   *  employee on a key, where it is an actual bill rather than a notional one. */
  costUsd: number;
  /** Set while the VP is waiting on this employee: collect their answer, then resolve. */
  delegation?: { answer: string; resolve: (answer: string) => void };
  /** on = live session and character. clockingOut = writing a handoff note, session
   *  still alive. off = no session, no character; stays on the roster, dimmed. */
  duty: EmployeeDuty;
  /** True between a text/tool event and the next result. Lets clockOut() tell an
   *  in-flight turn apart from an idle one, so it can wait for that turn's own
   *  result instead of hijacking it as the handoff summary's result. */
  turnActive: boolean;
  /** Set while clockOut() is waiting for the handoff summary that closes out this
   *  shift. Kept apart from `delegation` on purpose — sharing a slot would let a
   *  VP's in-flight delegation and this employee's own clock-out fight over the
   *  same result event. */
  handoff?: { answer: string; resolve: (text: string) => void };
  /** Set when clockOut() is called mid-turn: the handoff summary starts once the
   *  in-flight turn's own result arrives, not before. */
  pendingClockOut?: boolean;
}

/** A request the user has not answered yet. The ask is kept whole so it can be
 *  re-sent to a client that connects while the request is still up. */
interface PendingPermission {
  agentId: number;
  ask: PermissionAsk;
  /** Answers the employee's parked tool call. Safe to call more than once. */
  resolve: (allow: boolean) => void;
}

const staff = new Map<number, Staff>();
const pendingPermissions = new Map<string, PendingPermission>();

/** A character for an employee we started ourselves. `isExternal: false` keeps the
 *  stale-check (which only despawns external agents) from removing it. */
function newCharacter(id: number, cwd: string): AgentState {
  return {
    id,
    sessionId: '',
    isExternal: false,
    projectDir: cwd,
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function broadcastStaff(store: AgentStateStore): void {
  store.broadcast({
    type: 'employeeState',
    employees: [...staff.entries()].map(([agentId, s]) => ({
      agentId,
      name: s.name,
      cwd: s.cwd,
      role: s.role,
      duty: s.duty,
      ...(s.roleLabel ? { roleLabel: s.roleLabel } : {}),
      ...(s.persona ? { persona: s.persona } : {}),
      model: s.model,
      contextTokens: s.contextTokens,
      contextLimit: s.contextLimit,
      authMode: s.provider.mode,
      ownProvider: s.ownProvider !== undefined,
      costUsd: s.costUsd,
    })),
  });
}

function onEvent(
  store: AgentStateStore,
  runtime: AgentRuntime | undefined,
  agentId: number,
  event: EmployeeEvent,
): void {
  const current = staff.get(agentId);
  if (!current) return;

  switch (event.kind) {
    case 'ready': {
      // Bind the session to the character we already put in the office, so hook
      // events (typing, waiting, permission bubbles) reach the right one.
      const character = store.get(agentId);
      if (character) character.sessionId = event.sessionId;
      runtime?.registerAgent(event.sessionId, agentId);
      console.log(`[Pixel Agents] Employee ${agentId} ← session ${event.sessionId}`);
      break;
    }

    case 'text':
      current.turnActive = true;
      // While the VP is waiting on this employee, their answer is also the
      // delegation's return value — collect it as it streams.
      if (current.delegation) current.delegation.answer += event.text;
      if (current.handoff) {
        // The handoff summary is an internal turn, not something the user asked
        // for — collect it, but keep it out of the chat log.
        current.handoff.answer += event.text;
        break;
      }
      store.broadcast({ type: 'agentEvent', agentId, kind: 'text', text: event.text });
      break;

    case 'tool':
      current.turnActive = true;
      // Same reasoning as 'text' above — a tool call during the handoff summary
      // (the prompt only asks them not to make files, not to never use a tool)
      // is not something the user asked for either.
      if (current.handoff) break;
      store.broadcast({ type: 'agentEvent', agentId, kind: 'tool', text: event.text });
      break;

    case 'result': {
      current.turnActive = false;
      if (!current.handoff) {
        store.broadcast({ type: 'agentEvent', agentId, kind: 'result', text: event.text });
      }
      // Measured: the SDK reports the session's RUNNING TOTAL on every result, not
      // what the turn alone cost (turn 1: $0.4373, turn 2 of the same session:
      // $0.4595 — a one-word turn cannot cost another $0.46). So take it, never
      // add it, or every turn re-bills the whole session.
      if (event.costUsd > 0 && event.costUsd !== current.costUsd) {
        current.costUsd = event.costUsd;
        broadcastStaff(store);
      }
      const waiting = current.delegation;
      if (waiting) {
        current.delegation = undefined;
        waiting.resolve(waiting.answer.trim() || '(팀원이 답을 내놓지 않았습니다)');
      }
      if (current.handoff) {
        const handoff = current.handoff;
        handoff.resolve(handoff.answer.trim());
      } else if (current.pendingClockOut) {
        // The turn that was in flight when clockOut() was called just finished —
        // safe now to start the handoff summary as its own, freshly-tracked turn.
        current.pendingClockOut = false;
        startHandoffSummary(store, agentId);
      }
      break;
    }

    case 'usage': {
      // The reply is where a model switch is confirmed, so it is also the moment
      // the roster learns of it. Only on a change — usage lands every turn and the
      // roster is a file write.
      const switched = current.model !== event.model;
      current.model = event.model;
      current.contextTokens = event.contextTokens;
      current.contextLimit = event.contextLimit;
      broadcastStaff(store);
      if (switched) saveStaff();
      break;
    }

    case 'ended':
      if (current.duty === 'off') {
        // finishHandoff() already tore this down (character gone, roster entry
        // kept); this is just stop()'s async tail catching up. Nothing left to do.
        store.delete(agentId);
        break;
      }
      if (current.duty === 'clockingOut') {
        // The session died before (or during) the handoff summary — clock out
        // anyway, without a note. Clocking out must never get stuck.
        finishHandoff(store, agentId, null);
        break;
      }
      if (event.text) {
        store.broadcast({
          type: 'agentEvent',
          agentId,
          kind: 'result',
          text: `세션 오류: ${event.text}`,
        });
      }
      store.delete(agentId);
      staff.delete(agentId);
      broadcastStaff(store);
      break;
  }
}

/** Ask the user, and park the employee's tool call until they answer. The bubble
 *  over the character stays up the whole time, so a long wait is fine. */
function askPermission(
  store: AgentStateStore,
  agentId: number,
  ask: PermissionAsk,
): Promise<boolean> {
  return new Promise((resolve) => {
    // Whichever path answers first — the user's decision, the timeout, or dispose —
    // goes through here, so the request leaves the board and every client is told
    // the bubble is done exactly once. The Map delete is what makes it once.
    const settle = (allow: boolean): void => {
      if (!pendingPermissions.delete(ask.requestId)) return;
      clearTimeout(timer);
      store.broadcast({ type: 'agentPermissionResolved', agentId, requestId: ask.requestId });
      resolve(allow);
    };

    const timer = setTimeout(() => settle(false), PERMISSION_TIMEOUT_MS);

    pendingPermissions.set(ask.requestId, { agentId, ask, resolve: settle });

    store.broadcast({ type: 'agentPermissionRequest', agentId, ...ask });
  });
}

/** The VP's view of the staff, and the way work reaches them. */
function delegationFor(store: AgentStateStore): Delegation {
  return {
    listStaff: () => {
      const team = [...staff.values()].filter((s) => s.role === 'staff');
      if (team.length === 0) return '팀원이 없습니다.';
      return team.map((s) => `- ${s.name} (담당 폴더: ${s.cwd})`).join('\n');
    },

    delegate: (name, instruction) =>
      new Promise((resolve) => {
        const entry = [...staff.entries()].find(
          ([, s]) => s.role === 'staff' && s.name === name.trim(),
        );
        if (!entry) {
          resolve(`"${name}" 이라는 팀원이 없습니다. list_staff로 확인하세요.`);
          return;
        }
        const [agentId, member] = entry;
        if (member.duty !== 'on') {
          resolve(`${member.name}은(는) 지금 퇴근 상태입니다. 출근시킨 뒤 다시 시키세요.`);
          return;
        }
        if (member.delegation) {
          resolve(`${member.name}은(는) 지금 다른 작업 중입니다. 끝난 뒤에 다시 시키세요.`);
          return;
        }

        const timer = setTimeout(() => {
          if (member.delegation) {
            member.delegation = undefined;
            resolve(
              `${member.name}이(가) 15분 안에 끝내지 못했습니다. 아직 작업 중일 수 있습니다.`,
            );
          }
        }, DELEGATION_TIMEOUT_MS);

        member.delegation = {
          answer: '',
          resolve: (answer) => {
            clearTimeout(timer);
            resolve(answer);
          },
        };
        // Goes through the normal path, so the office shows the work happening and
        // any approval the team member needs still lands on the user.
        sendToEmployee(store, agentId, instruction);
      }),
  };
}

// ── Handoff notes (clock-out summaries) ─────────────────────────

function getHandoffDir(cwd: string): string {
  return path.join(cwd, '.ai-office', 'handoff');
}

/** Notes are named after when they were saved, so a plain sort orders them —
 *  and Windows forbids ':' in filenames, hence the hyphens. */
function handoffFileName(): string {
  return `${new Date().toISOString().replace(/:/g, '-')}.md`;
}

function stripFrontmatter(raw: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(raw);
  return (match ? raw.slice(match[0].length) : raw).trim();
}

/** The most recent handoff note's body (frontmatter stripped), or null if this
 *  employee has never clocked out — or the user deleted their notes — either of
 *  which is a normal, first-shift-like start. */
function readLatestHandoffNote(cwd: string): string | null {
  const dir = getHandoffDir(cwd);
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch {
    return null;
  }
  const latest = files[files.length - 1];
  if (!latest) return null;
  try {
    return stripFrontmatter(fs.readFileSync(path.join(dir, latest), 'utf8'));
  } catch {
    return null;
  }
}

/** Oldest-first cleanup past MAX_HANDOFF_NOTES — simple and predictable, per the
 *  user's own call on retention policy. */
function pruneOldHandoffNotes(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    for (let i = 0; i < files.length - MAX_HANDOFF_NOTES; i++) {
      fs.unlinkSync(path.join(dir, files[i]));
    }
  } catch (err) {
    console.warn('[Pixel Agents] failed to prune old handoff notes:', err);
  }
}

function writeHandoffNote(name: string, cwd: string, note: string): void {
  const dir = getHandoffDir(cwd);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, handoffFileName());
    const content =
      [
        '---',
        `employee: ${name}`,
        `cwd: ${cwd}`,
        `savedAt: ${new Date().toISOString()}`,
        '---',
        '',
      ].join('\n') +
      '\n' +
      note.trim() +
      '\n';
    // Atomic write — same pattern as layoutPersistence.ts.
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
    pruneOldHandoffNotes(dir);
  } catch (err) {
    console.warn('[Pixel Agents] failed to save handoff note:', err);
  }
}

/** Starts the handoff summary as its own turn — called either immediately by
 *  clockOut() (employee was idle) or from onEvent's result handler once an
 *  in-flight turn finishes (employee was mid-turn). */
function startHandoffSummary(store: AgentStateStore, agentId: number): void {
  const current = staff.get(agentId);
  if (!current?.employee) return;

  const timer = setTimeout(() => {
    finishHandoff(store, agentId, null);
  }, HANDOFF_SUMMARY_TIMEOUT_MS);

  current.handoff = {
    answer: '',
    resolve: (text) => {
      clearTimeout(timer);
      finishHandoff(store, agentId, text || null);
    },
  };
  // Sent directly (not sendToEmployee) — the user never asked for this, so it
  // must not appear as a `user` event in their chat.
  current.employee.send(HANDOFF_SUMMARY_PROMPT);
}

/** The one place a clock-out actually finishes: writes the note (or reports the
 *  failure), stops the session, and settles the roster entry to `duty: 'off'`
 *  without removing it — called from the handoff resolving normally, the
 *  summary timing out, or the session dying mid-summary. Idempotent, so any of
 *  those racing is harmless. */
function finishHandoff(store: AgentStateStore, agentId: number, note: string | null): void {
  const current = staff.get(agentId);
  if (!current || current.duty === 'off') return;

  current.handoff = undefined;
  current.pendingClockOut = false;

  if (note) {
    writeHandoffNote(current.name, current.cwd, note);
  } else {
    store.broadcast({
      type: 'agentEvent',
      agentId,
      kind: 'system',
      text: '인수인계 노트 저장 실패 — 노트 없이 퇴근합니다',
    });
  }

  current.employee?.stop();
  current.employee = undefined;
  current.duty = 'off';
  store.delete(agentId);
  saveStaff();
  broadcastStaff(store);
}

/** Clock this employee off: they summarize their shift into a handoff note
 *  (waiting for any turn already in flight to finish first, so it is not
 *  mistaken for that turn's own result), then their session closes. They stay
 *  on the roster, off duty, until clocked back in. */
export function clockOut(store: AgentStateStore, agentId: number): void {
  const current = staff.get(agentId);
  if (!current || current.duty !== 'on' || !current.employee) return;

  current.duty = 'clockingOut';
  broadcastStaff(store);

  if (current.turnActive) {
    current.pendingClockOut = true;
    return;
  }
  startHandoffSummary(store, agentId);
}

/** Clock this employee back on: a fresh session, reading whatever handoff note
 *  they left last time into context (no turn run — they only speak once the
 *  user does). */
export async function clockIn(
  store: AgentStateStore,
  agentId: number,
  runtime?: AgentRuntime,
): Promise<void> {
  const current = staff.get(agentId);
  if (!current || current.duty !== 'off') return;

  // Character first, same order as hireEmployee — the office shows them before
  // the session has even confirmed a sessionId (that binding happens on 'ready').
  store.set(agentId, newCharacter(agentId, current.cwd));

  const note = readLatestHandoffNote(current.cwd);

  // A fresh instance, not the stopped one — it is not built to restart, and its
  // old sessionId would still be sitting on it.
  const employee = new ClaudeEmployee(
    current.name,
    current.cwd,
    {
      onEvent: (event) => onEvent(store, runtime, agentId, event),
      askPermission: (ask) => askPermission(store, agentId, ask),
    },
    current.provider,
  );

  current.employee = employee;
  current.duty = 'on';

  await employee.start(
    current.model || undefined,
    current.role === 'vp' ? delegationFor(store) : undefined,
    current.persona,
    note ?? undefined,
  );

  saveStaff();
  broadcastStaff(store);
  console.log(`[Pixel Agents] Clocked in "${current.name}" (agent ${agentId})`);
}

export async function hireEmployee(
  store: AgentStateStore,
  name: string,
  cwd: string,
  role: EmployeeRole,
  model?: string,
  runtime?: AgentRuntime,
  /** The AI they bring themselves; omitted = whatever the office runs on. */
  ownProvider?: EmployeeProvider,
  /** What to call them on screen; omitted = the default label for their role. */
  roleLabel?: string,
  /** Their standing instructions, applied as the session starts. */
  persona?: string,
): Promise<void> {
  if (!name.trim() || !cwd.trim()) return;

  // The character comes first: it gives us the agentId everything else is keyed by,
  // and the office shows the employee as soon as they are hired.
  const agentId = store.nextAgentId.current++;
  store.set(agentId, newCharacter(agentId, cwd));

  // Resolved once, at hire time: the session keeps the credential it started with,
  // so changing the office default later cannot swap out a running employee's AI.
  const provider = resolveProvider(ownProvider);

  const employee = new ClaudeEmployee(
    name,
    cwd,
    {
      onEvent: (event) => onEvent(store, runtime, agentId, event),
      askPermission: (ask) => askPermission(store, agentId, ask),
    },
    provider,
  );

  staff.set(agentId, {
    employee,
    name,
    cwd,
    role,
    roleLabel,
    persona,
    // Seeded with what we started them on, so a re-hired employee keeps their
    // model in the roster even if they never take a turn. The next reply's usage
    // event is what confirms it.
    model: model ?? '',
    contextTokens: 0,
    contextLimit: 0,
    ownProvider,
    provider,
    costUsd: 0,
    duty: 'on',
    turnActive: false,
  });
  await employee.start(model, role === 'vp' ? delegationFor(store) : undefined, persona);
  broadcastStaff(store);
  saveStaff();
  console.log(
    `[Pixel Agents] Hired "${name}" (${role}, agent ${agentId}, ${provider.mode}) in ${cwd}`,
  );
}

export function fireEmployee(store: AgentStateStore, agentId: number): void {
  const current = staff.get(agentId);
  if (!current) return;
  current.employee?.stop();
  store.delete(agentId);
  staff.delete(agentId);
  broadcastStaff(store);
  saveStaff();
  console.log(`[Pixel Agents] Fired agent ${agentId}`);
}

export function sendToEmployee(store: AgentStateStore, agentId: number, text: string): void {
  const current = staff.get(agentId);
  if (!current || !text.trim()) return;
  if (!current.employee) {
    store.broadcast({
      type: 'agentEvent',
      agentId,
      kind: 'system',
      text: '퇴근한 직원입니다. 출근시킨 뒤 다시 시도하세요.',
    });
    return;
  }
  current.employee.send(text);
  store.broadcast({ type: 'agentEvent', agentId, kind: 'user', text });
}

export function resolveEmployeePermission(requestId: string, allow: boolean): void {
  const pending = pendingPermissions.get(requestId);
  if (!pending) return;
  pending.resolve(allow);
}

/** Whether this character is an employee we hired. Closing one from the office would
 *  leave their session running and their name on the roster — firing is the way out. */
export function isEmployee(agentId: number): boolean {
  return staff.has(agentId);
}

/** Every request still waiting on the user — what a client that just connected has
 *  to be told about, or it would show an office with nobody asking for anything. */
export function getPendingPermissionRequests(): Array<{ agentId: number; ask: PermissionAsk }> {
  return [...pendingPermissions.values()].map(({ agentId, ask }) => ({ agentId, ask }));
}

/** Switch one employee's model, mid-session. The UI confirms the switch once a
 *  reply comes back carrying the new model. Per-employee on purpose: the office
 *  default must never reach in and re-model everyone who is already working. */
export function setEmployeeModelFor(store: AgentStateStore, agentId: number, model: string): void {
  const current = staff.get(agentId);
  if (!current?.employee) return;
  void current.employee
    .setModel(model)
    // Said out loud in their chat: the switch lands silently otherwise, and the
    // header label cannot confirm it until the next reply reports what it ran on.
    .then(() => {
      store.broadcast({
        type: 'agentEvent',
        agentId,
        kind: 'system',
        text: `모델을 ${model}로 바꿨습니다. 다음 지시부터 적용됩니다.`,
      });
    })
    .catch((err) => {
      store.broadcast({
        type: 'agentEvent',
        agentId,
        kind: 'result',
        text: `모델 변경 실패: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
}

/** Change what an employee is called on screen. Display only — role, and the
 *  session it gates, are untouched, so this reaches every client immediately. */
export function renameEmployee(store: AgentStateStore, agentId: number, roleLabel: string): void {
  const current = staff.get(agentId);
  if (!current) return;
  current.roleLabel = roleLabel;
  saveStaff();
  broadcastStaff(store);
}

/** Rewrite an employee's standing instructions. Saved for the next hire only — the
 *  session already running never sees it, because employee.start() is not called
 *  again here. That silence is the point: a live conversation must not shift under
 *  the user mid-turn. */
export function setEmployeePersona(store: AgentStateStore, agentId: number, persona: string): void {
  const current = staff.get(agentId);
  if (!current) return;
  current.persona = persona;
  saveStaff();
  broadcastStaff(store);
}

/** Send the current staff to a client that just connected. */
export function sendStaffTo(store: AgentStateStore): void {
  broadcastStaff(store);
}

function saveStaff(): void {
  writeEmployees(
    [...staff.values()].map((s) => ({
      name: s.name,
      cwd: s.cwd,
      role: s.role,
      ...(s.roleLabel ? { roleLabel: s.roleLabel } : {}),
      ...(s.persona ? { persona: s.persona } : {}),
      ...(s.model ? { model: s.model } : {}),
      ...(s.ownProvider ? { provider: s.ownProvider } : {}),
      ...(s.duty === 'off' ? { offDuty: true } : {}),
    })),
  );
}

/** Register a clocked-out employee on the roster without starting a session or
 *  a character — the office shows them dimmed, until the user clocks them in. */
function registerOffDutyStaff(store: AgentStateStore, saved: SavedEmployee): void {
  const agentId = store.nextAgentId.current++;
  const provider = resolveProvider(saved.provider);
  staff.set(agentId, {
    name: saved.name,
    cwd: saved.cwd,
    role: saved.role ?? 'staff',
    roleLabel: saved.roleLabel,
    persona: saved.persona,
    model: saved.model ?? '',
    contextTokens: 0,
    contextLimit: 0,
    ownProvider: saved.provider,
    provider,
    costUsd: 0,
    duty: 'off',
    turnActive: false,
  });
  broadcastStaff(store);
}

/** Re-hire everyone from the roster when the office opens. Employees clocked
 *  out before the last save get no session or character — just their roster
 *  entry, off duty, waiting for the user to clock them back in. */
export async function rehireSavedEmployees(
  store: AgentStateStore,
  model?: string,
  runtime?: AgentRuntime,
): Promise<void> {
  for (const saved of readEmployees()) {
    if (saved.offDuty) {
      registerOffDutyStaff(store, saved);
      continue;
    }
    await hireEmployee(
      store,
      saved.name,
      saved.cwd,
      saved.role ?? 'staff',
      // Their own model outranks the office default: an employee put on Haiku
      // stays on Haiku across a restart.
      saved.model ?? model,
      runtime,
      saved.provider,
      saved.roleLabel,
      saved.persona,
    );
  }
}

/** Terminate every employee on server shutdown. */
export function disposeEmployees(): void {
  for (const [, current] of staff) current.employee?.stop();
  staff.clear();
  for (const [, pending] of pendingPermissions) pending.resolve(false);
  pendingPermissions.clear();
}
