import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { ClientMessageContext } from '../src/clientMessageHandler.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';

vi.mock('../src/claudeSettings.js', () => ({
  getConfiguredModel: vi.fn(() => 'office-default-model'),
}));

vi.mock('../src/employees.js', () => ({
  hireEmployee: vi.fn(async () => 1),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  fireEmployee: vi.fn(),
  getPendingPermissionRequests: vi.fn(() => []),
  isEmployee: vi.fn(() => false),
  listHandoffNotes: vi.fn(() => []),
  renameEmployee: vi.fn(),
  resolveEmployeePermission: vi.fn(),
  sendStaffTo: vi.fn(),
  sendToEmployee: vi.fn(),
  setEmployeeModelFor: vi.fn(),
  setEmployeePersona: vi.fn(),
  setEmployeeSeat: vi.fn(),
}));

const { hireEmployee, fireEmployee, listHandoffNotes } = await import('../src/employees.js');

function context(): ClientMessageContext {
  return { store: new AgentStateStore(), cache: null };
}

/** hireEmployee(store, name, cwd, role, model, ...) — only the model arg (index 4)
 *  matters for this suite; the rest is exercised elsewhere (employees.test.ts). */
function modelArgOf(call: number): unknown {
  return vi.mocked(hireEmployee).mock.calls[call][4];
}

/** hireEmployee's 12th positional arg — handoffFromKey (see employees.test.ts
 *  for the behavior it feeds; this suite only checks the wire-up). */
function handoffFromKeyArgOf(call: number): unknown {
  return vi.mocked(hireEmployee).mock.calls[call][11];
}

describe('handleClientMessage: hireEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('msg.model이 있으면 그 모델로 고용한다', () => {
    handleClientMessage(
      { type: 'hireEmployee', name: '코더', cwd: '/work', role: 'staff', model: 'claude-opus-4-8' },
      vi.fn(),
      context(),
    );

    expect(modelArgOf(0)).toBe('claude-opus-4-8');
  });

  it('msg.model이 없으면 사무실 기본 모델로 떨어진다', () => {
    handleClientMessage(
      { type: 'hireEmployee', name: '코더', cwd: '/work', role: 'staff' },
      vi.fn(),
      context(),
    );

    expect(modelArgOf(0)).toBe('office-default-model');
  });

  it('msg.model이 빈 문자열이면 사무실 기본 모델로 떨어진다', () => {
    handleClientMessage(
      { type: 'hireEmployee', name: '코더', cwd: '/work', role: 'staff', model: '' },
      vi.fn(),
      context(),
    );

    expect(modelArgOf(0)).toBe('office-default-model');
  });

  it('msg.handoffFromKey를 hireEmployee에 그대로 전달한다', () => {
    handleClientMessage(
      {
        type: 'hireEmployee',
        name: '코더',
        cwd: '/work',
        role: 'staff',
        handoffFromKey: '이전직원-abcd1234',
      },
      vi.fn(),
      context(),
    );

    expect(handoffFromKeyArgOf(0)).toBe('이전직원-abcd1234');
  });

  it('msg.handoffFromKey가 없으면 undefined로 전달한다', () => {
    handleClientMessage(
      { type: 'hireEmployee', name: '코더', cwd: '/work', role: 'staff' },
      vi.fn(),
      context(),
    );

    expect(handoffFromKeyArgOf(0)).toBeUndefined();
  });
});

describe('handleClientMessage: fireEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('msg.deleteHandoff를 fireEmployee에 그대로 전달한다', () => {
    handleClientMessage(
      { type: 'fireEmployee', agentId: 1, deleteHandoff: true },
      vi.fn(),
      context(),
    );

    expect(fireEmployee).toHaveBeenCalledWith(expect.anything(), 1, undefined, true);
  });

  it('msg.deleteHandoff가 없으면 undefined로 전달한다 (기본 = 남기기)', () => {
    handleClientMessage({ type: 'fireEmployee', agentId: 1 }, vi.fn(), context());

    expect(fireEmployee).toHaveBeenCalledWith(expect.anything(), 1, undefined, undefined);
  });
});

describe('handleClientMessage: listHandoffNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listHandoffNotes(cwd)의 결과를 요청한 클라이언트에게만 handoffNotesListed로 보낸다', () => {
    vi.mocked(listHandoffNotes).mockReturnValueOnce([
      { key: 'k1', employee: '코더', savedAt: '2026-07-01T00:00:00.000Z' },
    ]);
    const send = vi.fn();

    handleClientMessage({ type: 'listHandoffNotes', cwd: '/work' }, send, context());

    expect(listHandoffNotes).toHaveBeenCalledWith('/work');
    expect(send).toHaveBeenCalledWith({
      type: 'handoffNotesListed',
      cwd: '/work',
      notes: [{ key: 'k1', employee: '코더', savedAt: '2026-07-01T00:00:00.000Z' }],
    });
  });
});
