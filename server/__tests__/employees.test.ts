import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { EmployeeEvent } from '../src/employee.js';
import type { SavedEmployee } from '../src/employeePersistence.js';
import { readEmployees, writeEmployees } from '../src/employeePersistence.js';
import {
  disposeEmployees,
  hireEmployee,
  rehireSavedEmployees,
  setEmployeeModelFor,
} from '../src/employees.js';

/** The employee the registry actually hired, with the session stubbed out: no SDK,
 *  no process. `emit` is how a test plays the session talking back. */
interface FakeEmployee {
  startedWith: string | undefined;
  setModel: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emit(event: EmployeeEvent): void;
}

vi.mock('../src/employee.js', () => {
  const created: FakeEmployee[] = [];

  class ClaudeEmployee {
    startedWith: string | undefined;
    setModel = vi.fn(async (_model: string) => {});
    send = vi.fn();
    stop = vi.fn();
    private readonly onEvent: (event: EmployeeEvent) => void;

    constructor(_name: string, _cwd: string, host: { onEvent: (event: EmployeeEvent) => void }) {
      this.onEvent = host.onEvent;
      created.push(this as unknown as FakeEmployee);
    }

    async start(model?: string): Promise<void> {
      this.startedWith = model;
    }

    emit(event: EmployeeEvent): void {
      this.onEvent(event);
    }
  }

  return { ClaudeEmployee, __created: created };
});

vi.mock('../src/employeePersistence.js', () => ({
  readEmployees: vi.fn((): SavedEmployee[] => []),
  writeEmployees: vi.fn(),
}));

vi.mock('../src/aiProvider.js', () => ({
  resolveProvider: vi.fn(() => ({ mode: 'subscription' })),
}));

const created = ((await import('../src/employee.js')) as unknown as { __created: FakeEmployee[] })
  .__created;

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-5';

function usage(model: string): EmployeeEvent {
  return { kind: 'usage', model, contextTokens: 1000, contextLimit: 200_000 };
}

/** The roster as it stands after the last save. */
function savedRoster(): SavedEmployee[] {
  const calls = vi.mocked(writeEmployees).mock.calls;
  return calls.length ? calls[calls.length - 1][0] : [];
}

describe('employees', () => {
  let store: AgentStateStore;
  let broadcasts: Record<string, unknown>[];

  beforeEach(() => {
    vi.clearAllMocks();
    created.length = 0;
    store = new AgentStateStore();
    broadcasts = [];
    store.on('broadcast', (msg) => broadcasts.push(msg));
  });

  afterEach(() => {
    disposeEmployees();
  });

  describe('setEmployeeModelFor', () => {
    it('switches the model of that one employee', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      await hireEmployee(store, '검증', '/work', 'staff', SONNET);

      setEmployeeModelFor(store, 1, HAIKU);

      expect(created[0].setModel).toHaveBeenCalledWith(HAIKU);
      expect(created[1].setModel).not.toHaveBeenCalled();
    });

    it('says so in that employee’s chat once the switch lands', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      setEmployeeModelFor(store, 1, HAIKU);

      await vi.waitFor(() => {
        expect(broadcasts).toContainEqual({
          type: 'agentEvent',
          agentId: 1,
          kind: 'system',
          text: `모델을 ${HAIKU}로 바꿨습니다. 다음 지시부터 적용됩니다.`,
        });
      });
    });

    it('ignores an agentId nobody works under', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      setEmployeeModelFor(store, 99, HAIKU);

      expect(created[0].setModel).not.toHaveBeenCalled();
    });

    it('reports a failed switch in the employee’s own chat', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      created[0].setModel.mockRejectedValueOnce(new Error('세션이 응답하지 않음'));

      setEmployeeModelFor(store, 1, HAIKU);

      await vi.waitFor(() => {
        expect(broadcasts).toContainEqual({
          type: 'agentEvent',
          agentId: 1,
          kind: 'result',
          text: '모델 변경 실패: 세션이 응답하지 않음',
        });
      });
    });
  });

  describe('roster', () => {
    it('saves the model an employee is started on', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      expect(savedRoster()).toEqual([{ name: '코더', cwd: '/work', role: 'staff', model: SONNET }]);
    });

    it('saves the new model once the reply confirms the switch', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const writes = vi.mocked(writeEmployees).mock.calls.length;

      created[0].emit(usage(HAIKU));

      expect(savedRoster()[0].model).toBe(HAIKU);
      expect(vi.mocked(writeEmployees).mock.calls.length).toBe(writes + 1);
    });

    it('does not rewrite the roster on every turn', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      created[0].emit(usage(HAIKU));
      const writes = vi.mocked(writeEmployees).mock.calls.length;

      created[0].emit(usage(HAIKU));
      created[0].emit(usage(HAIKU));

      expect(vi.mocked(writeEmployees).mock.calls.length).toBe(writes);
    });

    it('re-hires an employee on their own model, not the office default', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '코더', cwd: '/work', role: 'staff', model: HAIKU },
        { name: '기획', cwd: '/plan', role: 'vp' },
      ]);

      await rehireSavedEmployees(store, SONNET);

      expect(created[0].startedWith).toBe(HAIKU);
      // No model on file: the office default is what they clock in on.
      expect(created[1].startedWith).toBe(SONNET);
    });
  });
});
