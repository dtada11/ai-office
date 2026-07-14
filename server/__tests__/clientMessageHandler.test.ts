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
  renameEmployee: vi.fn(),
  resolveEmployeePermission: vi.fn(),
  sendStaffTo: vi.fn(),
  sendToEmployee: vi.fn(),
  setEmployeeModelFor: vi.fn(),
  setEmployeePersona: vi.fn(),
  setEmployeeSeat: vi.fn(),
}));

const { hireEmployee } = await import('../src/employees.js');

function context(): ClientMessageContext {
  return { store: new AgentStateStore(), cache: null };
}

/** hireEmployee(store, name, cwd, role, model, ...) — only the model arg (index 4)
 *  matters for this suite; the rest is exercised elsewhere (employees.test.ts). */
function modelArgOf(call: number): unknown {
  return vi.mocked(hireEmployee).mock.calls[call][4];
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
});
