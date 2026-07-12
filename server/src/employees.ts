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

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { ClaudeEmployee, type Employee, type EmployeeEvent } from './employee.js';
import { readEmployees, writeEmployees } from './employeePersistence.js';
import type { AgentState } from './types.js';

/** How long a permission request waits for the user before being denied. */
const PERMISSION_TIMEOUT_MS = 30 * 60 * 1000;

interface Staff {
  employee: Employee;
  name: string;
  cwd: string;
  model: string;
  contextTokens: number;
  contextLimit: number;
}

const staff = new Map<number, Staff>();
const pendingPermissions = new Map<string, (allow: boolean) => void>();

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
      model: s.model,
      contextTokens: s.contextTokens,
      contextLimit: s.contextLimit,
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
    case 'tool':
      store.broadcast({ type: 'agentEvent', agentId, kind: event.kind, text: event.text });
      break;

    case 'result':
      store.broadcast({ type: 'agentEvent', agentId, kind: 'result', text: event.text });
      break;

    case 'usage':
      current.model = event.model;
      current.contextTokens = event.contextTokens;
      current.contextLimit = event.contextLimit;
      broadcastStaff(store);
      break;

    case 'ended':
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
  ask: { requestId: string; toolName: string; title: string; input: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingPermissions.delete(ask.requestId);
      resolve(false);
    }, PERMISSION_TIMEOUT_MS);

    pendingPermissions.set(ask.requestId, (allow) => {
      clearTimeout(timer);
      resolve(allow);
    });

    store.broadcast({ type: 'agentPermissionRequest', agentId, ...ask });
  });
}

export async function hireEmployee(
  store: AgentStateStore,
  name: string,
  cwd: string,
  model?: string,
  runtime?: AgentRuntime,
): Promise<void> {
  if (!name.trim() || !cwd.trim()) return;

  // The character comes first: it gives us the agentId everything else is keyed by,
  // and the office shows the employee as soon as they are hired.
  const agentId = store.nextAgentId.current++;
  store.set(agentId, newCharacter(agentId, cwd));

  const employee = new ClaudeEmployee(name, cwd, {
    onEvent: (event) => onEvent(store, runtime, agentId, event),
    askPermission: (ask) => askPermission(store, agentId, ask),
  });

  staff.set(agentId, { employee, name, cwd, model: '', contextTokens: 0, contextLimit: 0 });
  await employee.start(model);
  broadcastStaff(store);
  saveStaff();
  console.log(`[Pixel Agents] Hired "${name}" (agent ${agentId}) in ${cwd}`);
}

export function fireEmployee(store: AgentStateStore, agentId: number): void {
  const current = staff.get(agentId);
  if (!current) return;
  current.employee.stop();
  store.delete(agentId);
  staff.delete(agentId);
  broadcastStaff(store);
  saveStaff();
  console.log(`[Pixel Agents] Fired agent ${agentId}`);
}

export function sendToEmployee(store: AgentStateStore, agentId: number, text: string): void {
  const current = staff.get(agentId);
  if (!current || !text.trim()) return;
  current.employee.send(text);
  store.broadcast({ type: 'agentEvent', agentId, kind: 'user', text });
}

export function resolveEmployeePermission(requestId: string, allow: boolean): void {
  const resolve = pendingPermissions.get(requestId);
  if (!resolve) return;
  pendingPermissions.delete(requestId);
  resolve(allow);
}

/** Switch the model of every employee. The UI confirms the switch once a reply
 *  comes back carrying the new model. */
export function setEmployeeModel(store: AgentStateStore, model: string): void {
  for (const [agentId, current] of staff) {
    void current.employee.setModel(model).catch((err) => {
      store.broadcast({
        type: 'agentEvent',
        agentId,
        kind: 'result',
        text: `모델 변경 실패: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  }
}

/** Send the current staff to a client that just connected. */
export function sendStaffTo(store: AgentStateStore): void {
  broadcastStaff(store);
}

function saveStaff(): void {
  writeEmployees([...staff.values()].map((s) => ({ name: s.name, cwd: s.cwd })));
}

/** Re-hire everyone from the roster when the office opens. */
export async function rehireSavedEmployees(
  store: AgentStateStore,
  model?: string,
  runtime?: AgentRuntime,
): Promise<void> {
  for (const saved of readEmployees()) {
    await hireEmployee(store, saved.name, saved.cwd, model, runtime);
  }
}

/** Terminate every employee on server shutdown. */
export function disposeEmployees(): void {
  for (const [, current] of staff) current.employee.stop();
  staff.clear();
  for (const [, resolve] of pendingPermissions) resolve(false);
  pendingPermissions.clear();
}
