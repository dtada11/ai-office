/**
 * Employee registry — the office's staff.
 *
 * Holds every hired employee (each one an independent session) and routes the
 * webview's messages to the right one. Today the chat panel only ever hires one,
 * so the protocol still carries no employee id; the manager keeps a Map anyway
 * because that is the shape the office needs, and it is what the character
 * binding and delegation build on next.
 *
 * Scope/safety: standalone mode only (server binds to 127.0.0.1). Permission
 * mode stays at the SDK default — every tool call that needs approval goes
 * through askPermission, which asks the webview and waits.
 */

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { ClaudeEmployee, type Employee, type EmployeeEvent } from './employee.js';
import type { AgentState } from './types.js';

/** How long a permission request waits for the user before being denied. */
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

interface Staff {
  employee: Employee;
  model: string;
  contextTokens: number;
  contextLimit: number;
  /** The office character bound to this employee, once the session reports its id. */
  agentId?: number;
}

/** A character for an employee we started ourselves. `isExternal: false` keeps the
 *  stale-check (which only despawns external agents) from removing it, and we never
 *  register the folder for scanning — so no terminal session ever shows up here. */
function newCharacter(id: number, sessionId: string, cwd: string): AgentState {
  return {
    id,
    sessionId,
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

const staff = new Map<number, Staff>();
const pendingPermissions = new Map<string, (allow: boolean) => void>();

/** The single employee the current chat panel talks to. Goes away in the next
 *  step, when the webview starts naming the employee it means. */
const DEFAULT_ID = 1;

function broadcastState(store: AgentStateStore): void {
  const current = staff.get(DEFAULT_ID);
  store.broadcast({
    type: 'agentSessionState',
    running: current !== undefined,
    cwd: current?.employee.cwd ?? '',
    model: current?.model ?? '',
    contextTokens: current?.contextTokens ?? 0,
    contextLimit: current?.contextLimit ?? 0,
  });
}

function onEvent(
  store: AgentStateStore,
  runtime: AgentRuntime | undefined,
  id: number,
  event: EmployeeEvent,
): void {
  const current = staff.get(id);

  switch (event.kind) {
    case 'ready': {
      // Put the employee in the office ourselves. We do NOT register the folder
      // for scanning: that is what would drag the user's own terminal sessions in.
      if (!current || current.agentId !== undefined) break;
      const agentId = store.nextAgentId.current++;
      store.set(agentId, newCharacter(agentId, event.sessionId, current.employee.cwd));
      runtime?.registerAgent(event.sessionId, agentId);
      current.agentId = agentId;
      console.log(`[Pixel Agents] Employee character ${agentId} ← session ${event.sessionId}`);
      break;
    }

    case 'text':
    case 'tool':
      store.broadcast({ type: 'agentEvent', kind: event.kind, text: event.text });
      break;

    case 'result':
      store.broadcast({ type: 'agentEvent', kind: 'result', text: event.text });
      break;

    case 'usage':
      if (current) {
        current.model = event.model;
        current.contextTokens = event.contextTokens;
        current.contextLimit = event.contextLimit;
        broadcastState(store);
      }
      break;

    case 'ended':
      if (event.text) {
        store.broadcast({ type: 'agentEvent', kind: 'result', text: `세션 오류: ${event.text}` });
      }
      if (current?.agentId !== undefined) store.delete(current.agentId);
      staff.delete(id);
      broadcastState(store);
      break;
  }
}

/** Ask the user, and park the employee's tool call until they answer. */
function askPermission(
  store: AgentStateStore,
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

    store.broadcast({ type: 'agentPermissionRequest', ...ask });
  });
}

/** Hire an employee for a folder. Replaces the one already there (chat panel
 *  semantics today: one employee at a time). The name comes from the folder
 *  until the webview starts asking for one. */
export async function hireEmployee(
  store: AgentStateStore,
  cwd: string,
  model?: string,
  runtime?: AgentRuntime,
): Promise<void> {
  if (!cwd.trim()) return;
  fireEmployee(store, DEFAULT_ID);

  const id = DEFAULT_ID;
  const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
  const employee = new ClaudeEmployee(name, cwd, {
    onEvent: (event) => onEvent(store, runtime, id, event),
    askPermission: (ask) => askPermission(store, ask),
  });

  staff.set(id, { employee, model: '', contextTokens: 0, contextLimit: 0 });
  await employee.start(model);
  broadcastState(store);
  console.log(`[Pixel Agents] Employee "${name}" started in ${cwd}`);
}

export function sendToEmployee(store: AgentStateStore, text: string): void {
  const current = staff.get(DEFAULT_ID);
  if (!current || !text.trim()) return;
  current.employee.send(text);
  store.broadcast({ type: 'agentEvent', kind: 'user', text });
}

export function resolveEmployeePermission(requestId: string, allow: boolean): void {
  const resolve = pendingPermissions.get(requestId);
  if (!resolve) return;
  pendingPermissions.delete(requestId);
  resolve(allow);
}

/** Switch the model of a running employee (no-op when nobody is working). The UI
 *  confirms the switch once the next reply comes back carrying the new model. */
export function setEmployeeModel(store: AgentStateStore, model: string): void {
  const current = staff.get(DEFAULT_ID);
  if (!current) return;
  void current.employee.setModel(model).catch((err) => {
    store.broadcast({
      type: 'agentEvent',
      kind: 'result',
      text: `모델 변경 실패: ${err instanceof Error ? err.message : String(err)}`,
    });
  });
}

export function fireEmployee(store: AgentStateStore, id: number = DEFAULT_ID): void {
  const current = staff.get(id);
  if (!current) return;
  current.employee.stop();
  if (current.agentId !== undefined) store.delete(current.agentId);
  staff.delete(id);
  denyAllPending();
  broadcastState(store);
}

function denyAllPending(): void {
  for (const [, resolve] of pendingPermissions) resolve(false);
  pendingPermissions.clear();
}

/** Terminate every employee on server shutdown. */
export function disposeEmployees(): void {
  for (const [, current] of staff) current.employee.stop();
  staff.clear();
  denyAllPending();
}
