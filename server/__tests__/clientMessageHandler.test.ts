import { describe, expect, it, vi } from 'vitest';

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

describe('handleClientMessage: hireEmployee', () => {
  it('msg.model이 있으면 그 모델로 고용한다', () => {
    handleClientMessage(
      { type: 'hireEmployee', name: '코더', cwd: '/work', role: 'staff', model: 'claude-opus-4-8' },
      vi.fn(),
      context(),
    );

    expect(vi.mocked(hireEmployee)).toHaveBeenCalledWith(
      expect.anything(),
      '코더',
      '/work',
      'staff',
      'claude-opus-4-8',
      expect.anything(),
      undefined,
      undefined,
      undefined,
    );
  });

  it('msg.model이 없으면 사무실 기본 모델로 떨어진다', () => {
    handleClientMessage(
      { type: 'hireEmployee', name: '코더', cwd: '/work', role: 'staff' },
      vi.fn(),
      context(),
    );

    expect(vi.mocked(hireEmployee)).toHaveBeenCalledWith(
      expect.anything(),
      '코더',
      '/work',
      'staff',
      'office-default-model',
      expect.anything(),
      undefined,
      undefined,
      undefined,
    );
  });

  it('msg.model이 빈 문자열이면 사무실 기본 모델로 떨어진다', () => {
    handleClientMessage(
      { type: 'hireEmployee', name: '코더', cwd: '/work', role: 'staff', model: '' },
      vi.fn(),
      context(),
    );

    expect(vi.mocked(hireEmployee)).toHaveBeenCalledWith(
      expect.anything(),
      '코더',
      '/work',
      'staff',
      'office-default-model',
      expect.anything(),
      undefined,
      undefined,
      undefined,
    );
  });
});
