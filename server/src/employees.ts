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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { EmployeeDuty, EmployeeProvider, EmployeeRole } from '../../core/src/messages.js';
import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
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

/** Orphaned handoff folders (their employee no longer on the roster) kept per
 *  cwd, oldest deleted first past this count. Current employees' folders are
 *  never counted or pruned — this only caps notes left by departed employees. */
const MAX_HANDOFF_FOLDERS = 10;

const HANDOFF_SUMMARY_PROMPT = `지금 퇴근합니다. 다음 근무자에게 남길 인수인계 노트를 아래 세 항목으로 마크다운으로 작성해서, 답변 텍스트로만 알려주세요(파일을 만들지 마세요):

1. 이번 근무에서 완료한 일
2. 진행 중인 일과 현재 상태 (어디까지 했고 다음 단계는 무엇인지)
3. 다음 근무자가 알아야 할 것 (주의점·결정사항·막힌 지점)`;

/** A job the lead handed to this member. Not cleared on completion — the lead
 *  collects it later via collect(), and a cleared slot would lose the answer.
 *  Lives in memory only: a restart kills every session anyway, so a queued job
 *  has nothing to come back to. */
interface StaffDelegation {
  instruction: string;
  /** Streamed in from the member's text events while state is 'running', same
   *  as today. */
  answer: string;
  state: 'pending' | 'running' | 'done';
  /** What collect() awaits for a 'running' (or already-'done') delegation.
   *  Resolves when the member's turn ends, or on timeout. */
  done: Promise<string>;
  resolve: (answer: string) => void;
}

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
  /** The lead's job for this member, in whatever state it's in. See StaffDelegation. */
  delegation?: StaffDelegation;
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
  /** The look assigned on first spawn, frozen here (and in the roster) so it
   *  survives a restart or a fire/rehire elsewhere on the roster — appearance
   *  is tied to this employee, not to their agentId. Undefined until the
   *  webview's saveAgentSeats reports the palette pickDiversePalette() chose. */
  palette?: number;
  hueShift?: number;
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
function newCharacter(id: number, cwd: string, palette?: number, hueShift?: number): AgentState {
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
    palette,
    hueShift,
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
      // While a delegation is running, their answer is also collect()'s return
      // value — collect it as it streams. Guarded to 'running' only: a 'done'
      // delegation is finished but not yet collected, and a later turn (e.g. the
      // user chatting with them directly) must not be mistaken for its answer.
      if (current.delegation?.state === 'running') current.delegation.answer += event.text;
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
      store.broadcast({
        type: 'agentEvent',
        agentId,
        kind: 'tool',
        text: event.text,
        input: event.input,
      });
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
      // Only a 'running' delegation is this turn's own — a 'done' one already
      // resolved (normally or by timeout) and must not be resolved twice; a
      // stray result for a 'pending' one can't happen (no session is sending).
      if (waiting?.state === 'running') {
        waiting.state = 'done';
        waiting.resolve(waiting.answer.trim() || '(팀원이 답을 내놓지 않았습니다)');
      }
      if (current.handoff) {
        const handoff = current.handoff;
        handoff.resolve(handoff.answer.trim());
      } else if (current.pendingClockOut) {
        // The turn that was in flight when clockOut() was called just finished —
        // safe now to start the handoff summary as its own, freshly-tracked turn.
        current.pendingClockOut = false;
        startHandoffSummary(store, agentId, runtime);
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
        finishHandoff(store, agentId, null, runtime);
        break;
      }
      if (event.text) {
        store.broadcast({
          type: 'agentEvent',
          agentId,
          kind: 'result',
          text: `세션 오류: ${event.text}`,
        });
        // Hiring succeeded but the session died right away is the real-world
        // shape of a key/login error — surface it even if nobody has this
        // employee's chat window open (see officeNotice on hireEmployee).
        store.broadcast({
          type: 'officeNotice',
          level: 'error',
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

/** What list_staff shows after each team member's name/title — lets the lead see
 *  who can actually take work right now. */
function statusLabel(s: Staff): string {
  if (s.duty === 'clockingOut') {
    return s.delegation?.state === 'pending' ? '퇴근 중 (지시 보류 중)' : '퇴근 중';
  }
  if (s.duty === 'off') {
    return s.delegation?.state === 'pending' ? '퇴근 (지시 보류 중)' : '퇴근';
  }
  return s.delegation?.state === 'running' ? '작업 중' : '대기';
}

/** Fires a delegation for real: marks it running, starts the 15-minute timeout,
 *  announces it in the member's own chat, and sends the instruction through the
 *  normal path (so the office shows the work happening and any approval the
 *  member needs still lands on the user). Used both by a fresh delegate() and by
 *  clockIn() auto-firing a delegation that was held pending. */
function startRunningDelegation(
  store: AgentStateStore,
  agentId: number,
  member: Staff,
  instruction: string,
  announcement: string,
): void {
  let resolveDone!: (answer: string) => void;
  const done = new Promise<string>((res) => {
    resolveDone = res;
  });

  const timer = setTimeout(() => {
    // Guarded to 'running': if the real result already landed, this delegation
    // is already 'done' and its own resolve() already cleared this timer.
    if (member.delegation?.state === 'running') {
      member.delegation.state = 'done';
      resolveDone('시간 초과 — 아직 작업 중일 수 있습니다');
    }
  }, DELEGATION_TIMEOUT_MS);

  member.delegation = {
    instruction,
    answer: '',
    state: 'running',
    done,
    resolve: (answer) => {
      clearTimeout(timer);
      resolveDone(answer);
    },
  };

  store.broadcast({ type: 'agentEvent', agentId, kind: 'system', text: announcement });
  sendToEmployee(store, agentId, instruction);
}

/** The lead's view of the staff, and the way work reaches them. */
function delegationFor(store: AgentStateStore): Delegation {
  return {
    listStaff: () => {
      const team = [...staff.values()].filter((s) => s.role === 'staff');
      if (team.length === 0) return '팀원이 없습니다.';
      return team
        .map(
          (s) =>
            `- ${s.name}${s.roleLabel ? ` / ${s.roleLabel}` : ''} — ${statusLabel(s)} (담당 폴더: ${s.cwd})`,
        )
        .join('\n');
    },

    delegate: (name, instruction) => {
      const entry = [...staff.entries()].find(
        ([, s]) => s.role === 'staff' && s.name === name.trim(),
      );
      if (!entry) {
        return `"${name}" 이라는 팀원이 없습니다. list_staff로 확인하세요.`;
      }
      const [agentId, member] = entry;

      if (member.delegation?.state === 'running') {
        return `${member.name}은(는) 지금 작업 중입니다. 끝난 뒤에 다시 시키세요.`;
      }
      if (member.delegation?.state === 'pending') {
        return `${member.name}에게는 이미 보류된 지시가 있습니다.`;
      }
      // Only 'done' (finished, not yet collected) can still be here — delegate()
      // overwrites it rather than refusing, but says so, since silently dropping
      // an uncollected result would make it vanish without the lead knowing.
      const overwritingDone = member.delegation?.state === 'done';

      if (member.duty !== 'on') {
        let resolve!: (answer: string) => void;
        const done = new Promise<string>((res) => {
          resolve = res;
        });
        member.delegation = { instruction, answer: '', state: 'pending', done, resolve };
        return `${member.name}은(는) 퇴근 상태입니다. 지시를 보류했습니다 — 출근시키면 바로 시작합니다. 결과는 collect로 받으세요.`;
      }

      startRunningDelegation(store, agentId, member, instruction, '팀장 지시');

      return overwritingDone
        ? `${member.name}에게 맡겼습니다. (직전 결과가 수거되지 않아 버려집니다.) 결과는 collect로 받으세요.`
        : `${member.name}에게 맡겼습니다. 결과는 collect로 받으세요.`;
    },

    collect: async () => {
      const entries = [...staff.entries()].filter(([, s]) => s.role === 'staff' && s.delegation);
      if (entries.length === 0) return '맡긴 일이 없습니다.';

      const sections = await Promise.all(
        entries.map(async ([, member]) => {
          const label = `${member.name}${member.roleLabel ? ` / ${member.roleLabel}` : ''}`;
          // Non-null: this entry passed the s.delegation filter above.
          const delegation = member.delegation!;

          // Never awaited — the whole point is not to block on a member who
          // isn't even clocked in yet. Left in place for a later collect() or
          // clockIn()'s auto-fire to pick up.
          if (delegation.state === 'pending') {
            return `### ${label} — 출근 대기 중\n지시: ${delegation.instruction}`;
          }

          // 'running' and already-'done' both funnel through the same await —
          // a 'done' one's promise is already settled, so this returns at once.
          const answer = await delegation.done;
          if (member.delegation === delegation) member.delegation = undefined;
          return `### ${label}\n${answer}`;
        }),
      );

      return sections.join('\n\n');
    },
  };
}

// ── External-scanner ghost-readoption guard ─────────────────────

/** Where Claude would have written this employee's transcript, if the session
 *  ever got far enough to report a sessionId. Employee characters are bound by
 *  sessionId, not by watching this file (agent.jsonlFile is always '' for
 *  them) — but the file still exists on disk, and the external-session
 *  scanner (fileWatcher.ts) doesn't know that. */
function transcriptPathFor(cwd: string, sessionId: string): string {
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    normalizeProjectPath(cwd),
    `${sessionId}.jsonl`,
  );
}

/** Tell the external-session scanner to leave this employee's transcript
 *  alone, right before we remove their character. dd21ed3's own-agent guard
 *  (fileWatcher.ts scanExternalDir, matching agents.values()) only works
 *  while the character is still in the store — once store.delete() runs, the
 *  next scan tick sees an untracked, still-fresh .jsonl file and ghost-
 *  readopts it as a brand-new external agent. Only matters when the
 *  employee's cwd falls under a directory the scanner actually watches
 *  (trackedProjectDirs) — which in practice means "the folder the server
 *  itself was started in" — but dismissing unconditionally is harmless. */
function dismissEmployeeSession(runtime: AgentRuntime | undefined, current: Staff): void {
  const sessionId = current.employee?.sessionId;
  if (!runtime || !sessionId) return;
  runtime.dismissalTracker.dismiss(transcriptPathFor(current.cwd, sessionId));
  runtime.unregisterAgent(sessionId);
}

// ── Handoff notes (clock-out summaries) ─────────────────────────

/** A folder per employee under the cwd's handoff dir, so two employees that
 *  share a cwd (e.g. a lead over a repo and a staffer on the same repo) never
 *  read each other's notes. Exported so tests resolve the same path this code
 *  writes to. */
export function getHandoffDir(cwd: string, name: string): string {
  return path.join(cwd, '.ai-office', 'handoff', handoffKey(name));
}

/** Filesystem-safe folder segment identifying an employee within a cwd. A
 *  sanitized name for legibility, plus a short hash of the full name so two
 *  distinct names that sanitize to the same string still get separate folders
 *  (the whole point here is that notes never cross). */
function handoffKey(name: string): string {
  const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 8);
  const safe = name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return safe ? `${safe}-${hash}` : hash;
}

/** Resolve a handoff-note folder from a client-supplied key, but only if it is a
 *  direct child of this cwd's handoff dir. The key arrives over the wire (a hire
 *  form's "resume from" pick), so a value like '..\\..\\secrets' must not read
 *  notes out of an arbitrary directory. Returns null when the key would escape. */
function resolveHandoffDir(cwd: string, key: string): string | null {
  const base = path.resolve(cwd, '.ai-office', 'handoff');
  const target = path.resolve(base, key);
  return path.dirname(target) === base ? target : null;
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

/** The most recently saved note's filename in a handoff folder, or null if it
 *  has none (never written to, or the user cleared it) — shared by every
 *  reader below, so "which file is latest" is decided in exactly one place. */
function findLatestHandoffFile(dir: string): string | null {
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch {
    return null;
  }
  return files[files.length - 1] ?? null;
}

/** The most recent handoff note's body (frontmatter stripped) in a given
 *  folder, or null if it holds no readable note — either the folder never got
 *  written to, or something in it can't be read. `readLatestHandoffNote` (the
 *  by-name entry point used at clockIn) and `hireEmployee`'s by-key resume both
 *  wrap this — one and the same file-reading logic either way. */
function readLatestHandoffNoteFromDir(dir: string): string | null {
  const latest = findLatestHandoffFile(dir);
  if (!latest) return null;
  try {
    return stripFrontmatter(fs.readFileSync(path.join(dir, latest), 'utf8'));
  } catch {
    return null;
  }
}

/** The most recent handoff note's body (frontmatter stripped), or null if this
 *  employee has never clocked out — or the user deleted their notes — either of
 *  which is a normal, first-shift-like start. */
function readLatestHandoffNote(cwd: string, name: string): string | null {
  return readLatestHandoffNoteFromDir(getHandoffDir(cwd, name));
}

/** employee:/savedAt: out of a handoff note's frontmatter — just enough to list
 *  notes as "resume from" choices without reading the whole file into a doc
 *  model. Returns null when either field is missing (a note we can't summarize
 *  is a note listHandoffNotes should skip, not show blank). */
function parseHandoffFrontmatter(raw: string): { employee: string; savedAt: string } | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!match) return null;
  const employee = /^employee:\s*(.+)$/m.exec(match[1])?.[1]?.trim();
  const savedAt = /^savedAt:\s*(.+)$/m.exec(match[1])?.[1]?.trim();
  if (!employee || !savedAt) return null;
  return { employee, savedAt };
}

/** Like readLatestHandoffNoteFromDir, but the raw file (frontmatter and all) —
 *  listHandoffNotes needs the frontmatter itself, not the stripped body. */
function readLatestHandoffNoteRawFromDir(dir: string): string | null {
  const latest = findLatestHandoffFile(dir);
  if (!latest) return null;
  try {
    return fs.readFileSync(path.join(dir, latest), 'utf8');
  } catch {
    return null;
  }
}

/** Every employee folder's most recent handoff note under a cwd, newest first —
 *  what a hire form offers as "resume from" choices (see hireEmployee's
 *  handoffFromKey). Keyed by folder (see getHandoffDir), not by name: this is
 *  what lets a differently-named hire pick up someone else's notes directly.
 *  Empty array when the cwd has no handoff dir yet, or nothing in it parses. */
export function listHandoffNotes(
  cwd: string,
): { key: string; employee: string; savedAt: string }[] {
  const baseDir = path.join(cwd, '.ai-office', 'handoff');
  let keys: string[];
  try {
    keys = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const notes: { key: string; employee: string; savedAt: string }[] = [];
  for (const key of keys) {
    const raw = readLatestHandoffNoteRawFromDir(path.join(baseDir, key));
    if (raw === null) continue;
    const parsed = parseHandoffFrontmatter(raw);
    if (!parsed) continue;
    notes.push({ key, ...parsed });
  }

  notes.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  return notes;
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

/** Cap orphaned handoff folders under a cwd. A folder whose employee is still on
 *  the roster is always kept (they may clock back in); among the rest — left by
 *  fired or departed employees — only the most recent MAX_HANDOFF_FOLDERS stay,
 *  so a folder that sees a lot of turnover doesn't pile up notes forever.
 *  Ordered by each folder's latest note (filenames are timestamps, so a name
 *  sort is a time sort). */
function pruneOrphanedHandoffFolders(cwd: string): void {
  const baseDir = path.join(cwd, '.ai-office', 'handoff');
  const activeKeys = new Set(
    [...staff.values()].filter((s) => s.cwd === cwd).map((s) => handoffKey(s.name)),
  );
  let orphans: { key: string; latest: string }[];
  try {
    orphans = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !activeKeys.has(d.name))
      .map((d) => ({
        key: d.name,
        latest: findLatestHandoffFile(path.join(baseDir, d.name)) ?? '',
      }))
      .sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
  } catch {
    return;
  }
  for (const { key } of orphans.slice(MAX_HANDOFF_FOLDERS)) {
    try {
      fs.rmSync(path.join(baseDir, key), { recursive: true, force: true });
    } catch (err) {
      console.warn('[Pixel Agents] failed to prune orphaned handoff folder:', err);
    }
  }
}

function writeHandoffNote(name: string, cwd: string, note: string): void {
  const dir = getHandoffDir(cwd, name);
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
    pruneOrphanedHandoffFolders(cwd);
  } catch (err) {
    console.warn('[Pixel Agents] failed to save handoff note:', err);
  }
}

/** Starts the handoff summary as its own turn — called either immediately by
 *  clockOut() (employee was idle) or from onEvent's result handler once an
 *  in-flight turn finishes (employee was mid-turn). */
function startHandoffSummary(
  store: AgentStateStore,
  agentId: number,
  runtime: AgentRuntime | undefined,
): void {
  const current = staff.get(agentId);
  if (!current?.employee) return;

  const timer = setTimeout(() => {
    finishHandoff(store, agentId, null, runtime);
  }, HANDOFF_SUMMARY_TIMEOUT_MS);

  current.handoff = {
    answer: '',
    resolve: (text) => {
      clearTimeout(timer);
      finishHandoff(store, agentId, text || null, runtime);
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
function finishHandoff(
  store: AgentStateStore,
  agentId: number,
  note: string | null,
  runtime: AgentRuntime | undefined,
): void {
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

  // Before the character disappears — otherwise the external scanner
  // ghost-readopts the now-untracked transcript on its next tick.
  dismissEmployeeSession(runtime, current);

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
export function clockOut(store: AgentStateStore, agentId: number, runtime?: AgentRuntime): void {
  const current = staff.get(agentId);
  if (!current || current.duty !== 'on' || !current.employee) return;

  current.duty = 'clockingOut';
  broadcastStaff(store);

  if (current.turnActive) {
    current.pendingClockOut = true;
    return;
  }
  startHandoffSummary(store, agentId, runtime);
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
  store.set(agentId, newCharacter(agentId, current.cwd, current.palette, current.hueShift));

  const note = readLatestHandoffNote(current.cwd, current.name);

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
    current.role === 'lead' ? delegationFor(store) : undefined,
    current.persona,
    note ?? undefined,
  );

  // A delegation held while this member was off duty fires now that they have a
  // live session again — the lead never has to re-issue it.
  if (current.delegation?.state === 'pending') {
    startRunningDelegation(
      store,
      agentId,
      current,
      current.delegation.instruction,
      '팀장이 맡긴 일을 시작합니다.',
    );
  }

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
  /** Their frozen look, carried over from the roster on a rehire. Omitted for a
   *  brand-new hire — the webview picks one and reports it back via saveAgentSeats. */
  palette?: number,
  hueShift?: number,
  /** Resume from another (or the same) employee's most recent handoff note,
   *  read directly by folder key (see listHandoffNotes) — so a differently-named
   *  hire can pick up where someone else left off. Omitted = a plain
   *  first-shift start with no note. */
  handoffFromKey?: string,
): Promise<number | undefined> {
  if (!name.trim() || !cwd.trim()) return undefined;

  // The name doubles as the handoff key and the thing delegate() looks staff up
  // by, so two employees sharing one would blur both — office-wide, on or off
  // duty, regardless of cwd. rehireSavedEmployees() also calls hireEmployee and
  // so also passes through this same check — harmless, since the roster it
  // replays was itself built under this guard and can never hold a duplicate
  // name to begin with.
  const trimmedName = name.trim();
  if ([...staff.values()].some((s) => s.name === trimmedName)) {
    store.broadcast({
      type: 'officeNotice',
      level: 'error',
      text: `이미 "${trimmedName}" 직원이 있습니다. 다른 이름을 쓰세요.`,
    });
    return undefined;
  }

  // The character comes first: it gives us the agentId everything else is keyed by,
  // and the office shows the employee as soon as they are hired.
  const agentId = store.nextAgentId.current++;
  store.set(agentId, newCharacter(agentId, cwd, palette, hueShift));

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
    palette,
    hueShift,
  });
  // Read directly from the given folder key, not this employee's own name — the
  // whole point is that a brand-new (possibly differently-named) hire can pick
  // up a note anyone left behind.
  const handoffDir = handoffFromKey ? resolveHandoffDir(cwd, handoffFromKey) : null;
  const handoffNote = handoffDir
    ? (readLatestHandoffNoteFromDir(handoffDir) ?? undefined)
    : undefined;
  await employee.start(
    model,
    role === 'lead' ? delegationFor(store) : undefined,
    persona,
    handoffNote,
  );
  broadcastStaff(store);
  saveStaff();
  console.log(
    `[Pixel Agents] Hired "${name}" (${role}, agent ${agentId}, ${provider.mode}) in ${cwd}`,
  );
  return agentId;
}

export function fireEmployee(
  store: AgentStateStore,
  agentId: number,
  runtime?: AgentRuntime,
  /** Also delete this employee's handoff notes from disk. Omitted/false keeps
   *  them — clockOut's notes always survive fire unless the user asks for
   *  this explicitly, so a later hire can still offer to resume from them. */
  deleteHandoff?: boolean,
): void {
  const current = staff.get(agentId);
  if (!current) return;
  // Captured before the roster entry goes away — deleting the handoff dir
  // below needs both, and current is gone from `staff` a few lines from now.
  const { cwd, name } = current;
  // Same reasoning as finishHandoff(): before the character disappears, or the
  // external scanner ghost-readopts the now-untracked transcript.
  dismissEmployeeSession(runtime, current);
  current.employee?.stop();
  store.delete(agentId);
  staff.delete(agentId);
  if (deleteHandoff) {
    fs.rmSync(getHandoffDir(cwd, name), { recursive: true, force: true });
  }
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

/** Answers a parked tool call, and tells every tab what was decided — so
 *  "아까 뭘 승인했더라" has an answer even after the permission card is gone.
 *  agentId/toolName are not on the wire message that triggers this (only
 *  requestId and allow are); they come from the same pending-request entry
 *  the decision itself resolves, captured before resolve() lets it go. */
export function resolveEmployeePermission(
  store: AgentStateStore,
  requestId: string,
  allow: boolean,
): void {
  const pending = pendingPermissions.get(requestId);
  if (!pending) return;
  const { agentId, ask } = pending;
  pending.resolve(allow);
  store.broadcast({
    type: 'agentEvent',
    agentId,
    kind: 'system',
    text: allow ? `허용: ${ask.toolName}` : `거부: ${ask.toolName}`,
  });
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
      ...(s.palette !== undefined ? { palette: s.palette } : {}),
      ...(s.hueShift !== undefined ? { hueShift: s.hueShift } : {}),
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
    palette: saved.palette,
    hueShift: saved.hueShift,
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
  // The adapter's own agentId→seat map (existingAgents.agentMeta) is keyed by the
  // agentId each employee happened to get LAST run — stale the moment someone
  // earlier on the roster is fired, since everyone after them shifts down a slot.
  // Re-seed it here, under this run's freshly assigned agentIds, so a client that
  // connects before this employee ever takes a turn (no agentCreated for them —
  // they were created before any socket was listening) still sees the roster's
  // frozen look via existingAgents rather than whatever the old agentId's slot held.
  const adapter = store.getAdapter();
  const seats = adapter?.loadSeats();
  let seatsChanged = false;

  for (const saved of readEmployees()) {
    if (saved.offDuty) {
      registerOffDutyStaff(store, saved);
      continue;
    }
    const agentId = await hireEmployee(
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
      saved.palette,
      saved.hueShift,
    );
    if (seats && agentId !== undefined && saved.palette !== undefined) {
      seats[String(agentId)] = {
        ...seats[String(agentId)],
        palette: saved.palette,
        hueShift: saved.hueShift,
      };
      seatsChanged = true;
    }
  }

  if (seatsChanged && adapter && seats) {
    adapter.saveSeats(seats);
  }
}

/** Record an employee's chosen appearance so it survives a restart or a
 *  fire/rehire elsewhere on the roster (see the `saveAgentSeats` handler in
 *  clientMessageHandler.ts, which calls this only when the agentId belongs to
 *  an employee — a terminal session has no roster entry to freeze this into).
 *  Returns false when agentId isn't an employee, so the caller knows not to
 *  treat this as a roster write. */
export function setEmployeeSeat(agentId: number, palette?: number, hueShift?: number): boolean {
  const current = staff.get(agentId);
  if (!current) return false;
  current.palette = palette;
  current.hueShift = hueShift;
  saveStaff();
  return true;
}

/** Terminate every employee on server shutdown. */
export function disposeEmployees(): void {
  for (const [, current] of staff) current.employee?.stop();
  staff.clear();
  for (const [, pending] of pendingPermissions) pending.resolve(false);
  pendingPermissions.clear();
}
