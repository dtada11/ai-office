import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import type { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import type { Delegation, EmployeeEvent, PermissionAsk } from '../src/employee.js';
import type { SavedEmployee } from '../src/employeePersistence.js';
import { readEmployees, writeEmployees } from '../src/employeePersistence.js';
import {
  clockIn,
  clockOut,
  disposeEmployees,
  fireEmployee,
  getHandoffDir,
  getPendingPermissionRequests,
  hireEmployee,
  listHandoffNotes,
  rehireSavedEmployees,
  renameEmployee,
  resolveEmployeePermission,
  setEmployeeModelFor,
  setEmployeePersona,
  setEmployeeSeat,
} from '../src/employees.js';

/** The employee the registry actually hired, with the session stubbed out: no SDK,
 *  no process. `emit` is how a test plays the session talking back, and `ask` is how
 *  it plays a tool call that needs the user's approval. */
interface FakeEmployee {
  sessionId: string;
  startedWith: string | undefined;
  startedWithPersona: string | undefined;
  startedWithHandoffNote: string | undefined;
  startedWithDelegation: Delegation | undefined;
  start: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emit(event: EmployeeEvent): void;
  ask(ask: PermissionAsk): Promise<boolean>;
}

vi.mock('../src/employee.js', () => {
  const created: FakeEmployee[] = [];

  class ClaudeEmployee {
    sessionId = '';
    startedWith: string | undefined;
    startedWithPersona: string | undefined;
    startedWithHandoffNote: string | undefined;
    startedWithDelegation: Delegation | undefined;
    setModel = vi.fn(async (_model: string) => {});
    send = vi.fn();
    stop = vi.fn();
    private readonly onEvent: (event: EmployeeEvent) => void;
    private readonly askPermission: (ask: PermissionAsk) => Promise<boolean>;

    constructor(
      _name: string,
      _cwd: string,
      host: {
        onEvent: (event: EmployeeEvent) => void;
        askPermission: (ask: PermissionAsk) => Promise<boolean>;
      },
    ) {
      this.onEvent = host.onEvent;
      this.askPermission = host.askPermission;
      created.push(this as unknown as FakeEmployee);
    }

    start = vi.fn(
      async (
        model?: string,
        delegation?: Delegation,
        persona?: string,
        handoffNote?: string,
      ): Promise<void> => {
        this.startedWith = model;
        this.startedWithDelegation = delegation;
        this.startedWithPersona = persona;
        this.startedWithHandoffNote = handoffNote;
      },
    );

    emit(event: EmployeeEvent): void {
      // Mirrors real ClaudeEmployee.handle(): sessionId is set from the
      // session's own 'ready' report, same moment the host is told about it.
      if (event.kind === 'ready') this.sessionId = event.sessionId;
      this.onEvent(event);
    }

    ask(ask: PermissionAsk): Promise<boolean> {
      return this.askPermission(ask);
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

// aiProvider.js is mocked wholesale above (resolveProvider is stubbed so no real
// office-provider file I/O happens); normalizeProvider is pulled from the real
// module so the roster-migration test below exercises the actual function.
const { normalizeProvider } =
  await vi.importActual<typeof import('../src/aiProvider.js')>('../src/aiProvider.js');

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

/** Just enough of AgentRuntime for the ghost-readoption guard: dismiss the
 *  transcript and unregister the sessionId. Real AgentRuntime has far more —
 *  this is a partial stand-in, cast at the call site. */
function mockRuntime(): {
  dismissalTracker: { dismiss: ReturnType<typeof vi.fn> };
  unregisterAgent: ReturnType<typeof vi.fn>;
} {
  return { dismissalTracker: { dismiss: vi.fn() }, unregisterAgent: vi.fn() };
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

  describe('fireEmployee', () => {
    it('해임 시에도 트랜스크립트를 dismiss하고 unregisterAgent를 호출한다 (ghost-readoption 방지)', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      created[0].emit({ kind: 'ready', sessionId: 'sess-fire' });
      const runtime = mockRuntime();

      fireEmployee(store, 1, runtime as unknown as AgentRuntime);

      const expectedPath = path.join(
        os.homedir(),
        '.claude',
        'projects',
        normalizeProjectPath('/work'),
        'sess-fire.jsonl',
      );
      expect(runtime.dismissalTracker.dismiss).toHaveBeenCalledWith(expectedPath);
      expect(runtime.unregisterAgent).toHaveBeenCalledWith('sess-fire');
    });

    it('runtime이 없으면(VS Code 미사용) 조용히 건너뛴다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      created[0].emit({ kind: 'ready', sessionId: 'sess-fire2' });

      expect(() => fireEmployee(store, 1)).not.toThrow();
    });
  });

  describe('permissions', () => {
    const ASK: PermissionAsk = {
      requestId: 'req-1',
      toolName: 'Write',
      title: '파일을 쓰려고 합니다',
      input: '{"file_path":"/tmp/x"}',
    };

    it('asks the office when a tool call needs approval', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      void created[0].ask(ASK);

      expect(broadcasts).toContainEqual({ type: 'agentPermissionRequest', agentId: 1, ...ASK });
      expect(getPendingPermissionRequests()).toEqual([{ agentId: 1, ask: ASK }]);
    });

    it('tells every client the request is answered, and drops it', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const allowed = created[0].ask(ASK);

      resolveEmployeePermission(store, ASK.requestId, true);

      await expect(allowed).resolves.toBe(true);
      expect(broadcasts).toContainEqual({
        type: 'agentPermissionResolved',
        agentId: 1,
        requestId: ASK.requestId,
      });
      expect(getPendingPermissionRequests()).toEqual([]);
    });

    it('tells every client when the request times out unanswered', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      vi.useFakeTimers();
      try {
        const allowed = created[0].ask(ASK);

        vi.advanceTimersByTime(30 * 60 * 1000);

        await expect(allowed).resolves.toBe(false);
        expect(broadcasts).toContainEqual({
          type: 'agentPermissionResolved',
          agentId: 1,
          requestId: ASK.requestId,
        });
        expect(getPendingPermissionRequests()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves the requests nobody has answered yet on the board', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      await hireEmployee(store, '검증', '/work', 'staff', SONNET);
      const second: PermissionAsk = { ...ASK, requestId: 'req-2' };
      void created[0].ask(ASK);
      void created[1].ask(second);

      resolveEmployeePermission(store, ASK.requestId, false);

      expect(getPendingPermissionRequests()).toEqual([{ agentId: 2, ask: second }]);
    });

    it('허용 결정은 로그에 남도록 시스템 이벤트로 broadcast된다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      void created[0].ask(ASK);

      resolveEmployeePermission(store, ASK.requestId, true);

      expect(broadcasts).toContainEqual({
        type: 'agentEvent',
        agentId: 1,
        kind: 'system',
        text: `허용: ${ASK.toolName}`,
      });
    });

    it('거부 결정도 로그에 남도록 시스템 이벤트로 broadcast된다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      void created[0].ask(ASK);

      resolveEmployeePermission(store, ASK.requestId, false);

      expect(broadcasts).toContainEqual({
        type: 'agentEvent',
        agentId: 1,
        kind: 'system',
        text: `거부: ${ASK.toolName}`,
      });
    });

    it('이미 처리된(사라진) 요청에 대한 결정은 조용히 무시된다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      void created[0].ask(ASK);
      resolveEmployeePermission(store, ASK.requestId, true);
      broadcasts.length = 0;

      resolveEmployeePermission(store, ASK.requestId, true);

      expect(broadcasts).toEqual([]);
    });
  });

  describe('tool events', () => {
    it('도구 호출 이벤트는 input을 함께 broadcast한다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      created[0].emit({ kind: 'tool', text: 'Edit', input: '{"file_path":"/a.ts"}' });

      expect(broadcasts).toContainEqual({
        type: 'agentEvent',
        agentId: 1,
        kind: 'tool',
        text: 'Edit',
        input: '{"file_path":"/a.ts"}',
      });
    });

    it('input이 없는 도구 이벤트도 여전히 broadcast된다(도구 이름만이라도 남는다)', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      created[0].emit({ kind: 'tool', text: 'Bash' });

      expect(broadcasts).toContainEqual({
        type: 'agentEvent',
        agentId: 1,
        kind: 'tool',
        text: 'Bash',
        input: undefined,
      });
    });
  });

  describe('roleLabel', () => {
    it('is stored at hire time and shows up in the broadcast', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET, undefined, undefined, 'PM');

      expect(broadcasts).toContainEqual(
        expect.objectContaining({
          type: 'employeeState',
          employees: [expect.objectContaining({ agentId: 1, roleLabel: 'PM' })],
        }),
      );
    });

    it('renameEmployee changes only the label, without touching the running session', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      created[0].start.mockClear();

      renameEmployee(store, 1, 'PM');

      expect(created[0].start).not.toHaveBeenCalled();
      expect(savedRoster()[0]).toEqual(expect.objectContaining({ name: '코더', roleLabel: 'PM' }));
      expect(broadcasts).toContainEqual(
        expect.objectContaining({
          type: 'employeeState',
          employees: [expect.objectContaining({ roleLabel: 'PM' })],
        }),
      );
    });

    it('ignores an agentId nobody works under', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const writes = vi.mocked(writeEmployees).mock.calls.length;

      renameEmployee(store, 99, 'PM');

      expect(vi.mocked(writeEmployees).mock.calls.length).toBe(writes);
    });
  });

  describe('persona', () => {
    const PERSONA = '당신은 꼼꼼하고 보수적인 백엔드 담당입니다';

    it('is passed to the session at hire time', async () => {
      await hireEmployee(
        store,
        '코더',
        '/work',
        'staff',
        SONNET,
        undefined,
        undefined,
        undefined,
        PERSONA,
      );

      expect(created[0].startedWithPersona).toBe(PERSONA);
    });

    it('setEmployeePersona saves the new text and broadcasts it, but never restarts the session', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      created[0].start.mockClear();

      setEmployeePersona(store, 1, PERSONA);

      // The one guarantee that matters: a live conversation must not shift under
      // the user mid-turn. Saving a new persona must not re-issue start().
      expect(created[0].start).not.toHaveBeenCalled();
      expect(savedRoster()[0]).toEqual(expect.objectContaining({ persona: PERSONA }));
      expect(broadcasts).toContainEqual(
        expect.objectContaining({
          type: 'employeeState',
          employees: [expect.objectContaining({ persona: PERSONA })],
        }),
      );
    });

    it('ignores an agentId nobody works under', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const writes = vi.mocked(writeEmployees).mock.calls.length;

      setEmployeePersona(store, 99, PERSONA);

      expect(vi.mocked(writeEmployees).mock.calls.length).toBe(writes);
    });
  });

  describe('roster', () => {
    it('saves the model an employee is started on', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      // 전체 모양을 그대로 못 박는다 — permissionKey는 고용 때 난수로 발급되므로
      // 값이 아니라 "실려 있다"는 사실만 확인한다(그 값이 무엇인지는 B-3이 지킨다).
      expect(savedRoster()).toEqual([
        {
          name: '코더',
          permissionKey: expect.any(String),
          cwd: '/work',
          role: 'staff',
          model: SONNET,
        },
      ]);
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
        { name: '기획', cwd: '/plan', role: 'lead' },
      ]);

      await rehireSavedEmployees(store, SONNET);

      expect(created[0].startedWith).toBe(HAIKU);
      // No model on file: the office default is what they clock in on.
      expect(created[1].startedWith).toBe(SONNET);
    });

    it('re-hires an employee with their saved title and instructions', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '코더', cwd: '/work', role: 'staff', roleLabel: 'PM', persona: '꼼꼼하게' },
      ]);

      await rehireSavedEmployees(store, SONNET);

      expect(created[0].startedWithPersona).toBe('꼼꼼하게');
      expect(broadcasts).toContainEqual(
        expect.objectContaining({
          type: 'employeeState',
          employees: [expect.objectContaining({ roleLabel: 'PM', persona: '꼼꼼하게' })],
        }),
      );
    });
  });

  describe('listStaff (라우팅 근거)', () => {
    it('직함이 있으면 포함하고, 없으면 이름과 폴더만 보여준다 — 상태도 함께 보여준다', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      await hireEmployee(store, '코더', '/work', 'staff', SONNET, undefined, undefined, '개발자');
      await hireEmployee(store, '무직함', '/no-label', 'staff', SONNET);

      const delegation = created[0].startedWithDelegation;
      const result = delegation?.listStaff();

      expect(result).toContain('- 코더 / 개발자 — 대기 (담당 폴더: /work)');
      expect(result).toContain('- 무직함 — 대기 (담당 폴더: /no-label)');
    });

    it('작업 중인 팀원은 상태가 "작업 중"으로 보인다', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const delegation = created[0].startedWithDelegation!;

      delegation.delegate('코더', '작업');

      expect(delegation.listStaff()).toContain('- 코더 — 작업 중 (담당 폴더: /work)');
    });
  });

  describe('비블로킹 위임 (delegate 즉시 반환 + collect로 수거)', () => {
    it('연속으로 delegate한 두 건 모두 즉시 반환되고, 둘 다 sendToEmployee가 곧바로 호출된다 (팬아웃)', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      await hireEmployee(store, '검증', '/work2', 'staff', SONNET);
      const delegation = created[0].startedWithDelegation!;

      const r1 = delegation.delegate('코더', '로그인 API');
      const r2 = delegation.delegate('검증', '인증 테스트');

      // 문자열이 즉시 나온다는 것 자체가 "기다리지 않는다"는 증거 — 여전히
      // Promise를 반환한다면 .toContain은 타입상 실패한다.
      expect(r1).toContain('코더에게 맡겼습니다');
      expect(r2).toContain('검증에게 맡겼습니다');
      expect(created[1].send).toHaveBeenCalledWith('로그인 API');
      expect(created[2].send).toHaveBeenCalledWith('인증 테스트');
    });

    it('팀장 지시로 보낸 것임을 팀원 채팅에 system 이벤트로 남긴다', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const delegation = created[0].startedWithDelegation!;

      delegation.delegate('코더', '작업');

      expect(broadcasts).toContainEqual({
        type: 'agentEvent',
        agentId: 2,
        kind: 'system',
        text: '팀장 지시',
      });
    });

    it('collect는 running인 위임을 전부 동시에 기다린다 — 하나만 끝나도 반환하지 않고, 둘 다 끝나야 반환한다', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      await hireEmployee(store, '검증', '/work2', 'staff', SONNET);
      const delegation = created[0].startedWithDelegation!;

      delegation.delegate('코더', '작업1');
      delegation.delegate('검증', '작업2');

      let settled = false;
      const collectPromise = delegation.collect().then((r) => {
        settled = true;
        return r;
      });

      // 코더만 먼저 끝난다.
      created[1].emit({ kind: 'text', text: '코더 결과' });
      created[1].emit({ kind: 'result', text: '', costUsd: 0 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false); // 검증이 아직이니 Promise.all은 아직 안 끝난다

      // 검증도 끝난다.
      created[2].emit({ kind: 'text', text: '검증 결과' });
      created[2].emit({ kind: 'result', text: '', costUsd: 0 });

      const result = await collectPromise;
      expect(result).toContain('### 코더\n코더 결과');
      expect(result).toContain('### 검증\n검증 결과');
    });

    it('아무것도 맡기지 않았으면 collect는 그렇게 보고한다', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      const delegation = created[0].startedWithDelegation!;

      await expect(delegation.collect()).resolves.toBe('맡긴 일이 없습니다.');
    });

    it('퇴근한 팀원에게 delegate하면 pending으로 보류되고 sendToEmployee는 불리지 않는다; collect는 기다리지 않고 즉시 보고한다', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '팀장', cwd: '/lead', role: 'lead' },
        { name: '코더', cwd: '/work', role: 'staff', offDuty: true },
      ]);
      await rehireSavedEmployees(store, SONNET);
      const delegation = created[0].startedWithDelegation!;

      const result = delegation.delegate('코더', '로그인 버그 수정');

      expect(result).toContain('퇴근 상태');
      expect(result).toContain('보류');
      expect(created).toHaveLength(1); // 코더는 세션이 없다 — send를 호출할 대상 자체가 없음

      const collected = await delegation.collect();
      expect(collected).toContain('출근 대기 중');
      expect(collected).toContain('로그인 버그 수정');
    });

    it('퇴근 보류 상태에서 출근시키면 지시가 자동으로 발사된다', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '팀장', cwd: '/lead', role: 'lead' },
        { name: '코더', cwd: '/work', role: 'staff', offDuty: true },
      ]);
      await rehireSavedEmployees(store, SONNET);
      const delegation = created[0].startedWithDelegation!;
      delegation.delegate('코더', '로그인 버그 수정');

      await clockIn(store, 2);

      expect(created).toHaveLength(2);
      expect(created[1].send).toHaveBeenCalledWith('로그인 버그 수정');
      expect(broadcasts).toContainEqual({
        type: 'agentEvent',
        agentId: 2,
        kind: 'system',
        text: '팀장이 맡긴 일을 시작합니다.',
      });
    });

    it('작업 중인 팀원에게 또 delegate하면 거부되고 sendToEmployee도 다시 불리지 않는다', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const delegation = created[0].startedWithDelegation!;
      delegation.delegate('코더', '작업1');
      created[1].send.mockClear();

      const result = delegation.delegate('코더', '작업2');

      expect(result).toContain('작업 중');
      expect(created[1].send).not.toHaveBeenCalled();
    });

    it('보류 중인 팀원에게 또 delegate하면 거부된다', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '팀장', cwd: '/lead', role: 'lead' },
        { name: '코더', cwd: '/work', role: 'staff', offDuty: true },
      ]);
      await rehireSavedEmployees(store, SONNET);
      const delegation = created[0].startedWithDelegation!;
      delegation.delegate('코더', '작업1');

      const result = delegation.delegate('코더', '작업2');

      expect(result).toContain('이미 보류된 지시');
    });

    it('done(미수거) 상태인 팀원에게 delegate하면 덮어쓰되 경고 문구가 반환된다', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const delegation = created[0].startedWithDelegation!;
      delegation.delegate('코더', '작업1');
      created[1].emit({ kind: 'text', text: '결과1' });
      created[1].emit({ kind: 'result', text: '', costUsd: 0 });
      // collect()를 아직 부르지 않았다 — done 상태로 미수거인 채 남아있다.

      const result = delegation.delegate('코더', '작업2');

      expect(result).toContain('버려집니다');
      expect(created[1].send).toHaveBeenCalledWith('작업2');
    });

    it('15분 안에 끝나지 않으면 시간 초과로 처리되고 collect가 그 사실을 보고한다', async () => {
      await hireEmployee(store, '팀장', '/lead', 'lead', SONNET);
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const delegation = created[0].startedWithDelegation!;

      vi.useFakeTimers();
      try {
        delegation.delegate('코더', '오래 걸리는 작업');
        vi.advanceTimersByTime(15 * 60 * 1000);

        const result = await delegation.collect();
        expect(result).toContain('시간 초과');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('palette/hueShift (외모 고정)', () => {
    it('setEmployeeSeat: 직원 agentId면 로스터에 기록하고 true를 반환한다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      const result = setEmployeeSeat(1, 3, 90);

      expect(result).toBe(true);
      expect(savedRoster()[0]).toEqual(expect.objectContaining({ palette: 3, hueShift: 90 }));
    });

    it('setEmployeeSeat: 직원이 아닌 agentId(터미널 세션)는 false를 반환하고 로스터를 건드리지 않는다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);
      const writes = vi.mocked(writeEmployees).mock.calls.length;

      const result = setEmployeeSeat(999, 3, 90);

      expect(result).toBe(false);
      expect(vi.mocked(writeEmployees).mock.calls.length).toBe(writes);
    });

    it('핵심 회귀: 가운데 직원을 해고하고 재시작해도 남은 직원들의 palette는 안 밀린다 (agentId는 밀려도 얼굴은 그대로)', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '1번', cwd: '/a', role: 'staff', palette: 0, hueShift: 0 },
        { name: '2번', cwd: '/b', role: 'staff', palette: 1, hueShift: 90 },
        { name: '3번', cwd: '/c', role: 'staff', palette: 2, hueShift: 180 },
      ]);
      await rehireSavedEmployees(store, SONNET);
      // agentId 1='1번'(palette 0), 2='2번'(palette 1), 3='3번'(palette 2)

      // 2번 해고 후 재시작 시 로스터에 남는 모습을 시뮬레이션 — 2번이 빠지고
      // 1번·3번만 남는다(순서 유지).
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '1번', cwd: '/a', role: 'staff', palette: 0, hueShift: 0 },
        { name: '3번', cwd: '/c', role: 'staff', palette: 2, hueShift: 180 },
      ]);

      // 서버 재시작 시뮬레이션: staff 맵과 store를 모두 새로 만든다.
      disposeEmployees();
      created.length = 0;
      store = new AgentStateStore();
      broadcasts = [];
      store.on('broadcast', (msg) => broadcasts.push(msg));

      await rehireSavedEmployees(store, SONNET);
      // 이번엔 agentId 1='1번', agentId 2='3번' — 3번의 agentId가 3→2로 밀렸다.

      expect(store.get(1)?.palette).toBe(0);
      expect(store.get(1)?.hueShift).toBe(0);
      expect(store.get(2)?.palette).toBe(2);
      expect(store.get(2)?.hueShift).toBe(180);
    });
  });

  describe('legacy provider migration', () => {
    it('oauthToken 로스터 항목은 사무실 기본으로 폴백하고, 재저장 시 provider가 사라진다', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        {
          name: '코더',
          cwd: '/work',
          role: 'staff',
          // Simulates what employeePersistence.readEmployees() now returns for a
          // legacy {mode:'oauthToken'} record: normalizeProvider() drops it to
          // undefined, so the employee has no provider of its own.
          provider: normalizeProvider({ mode: 'oauthToken', oauthToken: 'x' }),
        },
      ]);

      await rehireSavedEmployees(store, SONNET);

      expect(broadcasts).toContainEqual(
        expect.objectContaining({
          type: 'employeeState',
          employees: [expect.objectContaining({ agentId: 1, ownProvider: false })],
        }),
      );

      // Any later save (e.g. a persona edit) must not resurrect the dead field.
      setEmployeePersona(store, 1, '메모');
      expect(savedRoster()[0]).not.toHaveProperty('provider');
    });
  });

  // Handoff notes hit the real filesystem (writeHandoffNote/readLatestHandoffNote),
  // so these use a real temp cwd rather than the fake '/work' the other tests use —
  // never the user's actual home or project folder (lesson from 042f97c).
  describe('duty (clock in/out)', () => {
    let tmpCwd: string;

    beforeEach(() => {
      tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-office-duty-'));
    });

    afterEach(() => {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    });

    // Notes now live in a per-employee subfolder. Default to 코더 since that is
    // whom these tests hire, and delegate to the code's own resolver so the
    // test can never drift from the real key derivation.
    function handoffDir(cwd: string, name = '코더'): string {
      return getHandoffDir(cwd, name);
    }

    it('퇴근하면 요약이 md로 저장되고, 캐릭터는 사라지지만 명부에는 duty:off로 남는다', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);

      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '오늘 로그인 버그를 고쳤습니다.' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });

      const files = fs.readdirSync(handoffDir(tmpCwd));
      expect(files).toHaveLength(1);
      const saved = fs.readFileSync(path.join(handoffDir(tmpCwd), files[0]), 'utf8');
      expect(saved).toContain('오늘 로그인 버그를 고쳤습니다.');

      expect(store.get(1)).toBeUndefined();
      expect(broadcasts).toContainEqual(
        expect.objectContaining({
          type: 'employeeState',
          employees: [expect.objectContaining({ agentId: 1, duty: 'off' })],
        }),
      );
    });

    it('퇴근 완료 시 트랜스크립트를 dismiss하고 unregisterAgent를 호출한다 (ghost-readoption 방지)', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      created[0].emit({ kind: 'ready', sessionId: 'sess-clockout' });
      const runtime = mockRuntime();

      clockOut(store, 1, runtime as unknown as AgentRuntime);
      created[0].emit({ kind: 'text', text: '요약 내용' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });

      const expectedPath = path.join(
        os.homedir(),
        '.claude',
        'projects',
        normalizeProjectPath(tmpCwd),
        'sess-clockout.jsonl',
      );
      expect(runtime.dismissalTracker.dismiss).toHaveBeenCalledWith(expectedPath);
      expect(runtime.unregisterAgent).toHaveBeenCalledWith('sess-clockout');
    });

    it('요약 중 text 이벤트는 채팅창으로 broadcast되지 않는다', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);

      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '민감한 요약 내용' });

      expect(broadcasts).not.toContainEqual(
        expect.objectContaining({ type: 'agentEvent', kind: 'text', text: '민감한 요약 내용' }),
      );
    });

    it('요약 중 tool 이벤트도 채팅창으로 broadcast되지 않는다', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);

      clockOut(store, 1);
      created[0].emit({ kind: 'tool', text: 'Read' });

      expect(broadcasts).not.toContainEqual(
        expect.objectContaining({ type: 'agentEvent', kind: 'tool', text: 'Read' }),
      );
    });

    it('진행 중인 턴이 있으면 그 턴의 result가 아니라 요약 턴의 result에서 resolve된다', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);

      // A turn is already in flight when the user clicks 퇴근.
      created[0].emit({ kind: 'text', text: '기존 작업 응답' });
      clockOut(store, 1);

      // The summary prompt must not be sent yet — the in-flight turn owns the
      // session until its own result arrives.
      expect(created[0].send).not.toHaveBeenCalled();

      // That in-flight turn finishes.
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });

      // Only now does the handoff summary start.
      expect(created[0].send).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(handoffDir(tmpCwd))).toBe(false);

      // The summary turn itself runs and finishes.
      created[0].emit({ kind: 'text', text: '요약 내용' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });

      const files = fs.readdirSync(handoffDir(tmpCwd));
      expect(files).toHaveLength(1);
    });

    it('노트 11개째를 저장하면 가장 오래된 1개가 삭제되어 10개로 유지된다', async () => {
      const dir = handoffDir(tmpCwd);
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(dir, `2020-01-01T00-00-0${i}.000Z.md`), `old note ${i}`);
      }

      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '열한 번째 노트' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });

      const files = fs.readdirSync(dir).sort();
      expect(files).toHaveLength(10);
      expect(files).not.toContain('2020-01-01T00-00-00.000Z.md');
      expect(files).toContain('2020-01-01T00-00-01.000Z.md');
    });

    it('cwd당 고아 인계 폴더가 상한을 넘으면 오래된 폴더부터 삭제된다(현재 직원 폴더는 보존)', async () => {
      const base = path.join(tmpCwd, '.ai-office', 'handoff');
      // 떠난 직원(고아) 폴더 12개를 서로 다른 타임스탬프로 심는다 (상한 10 + 2).
      for (let i = 0; i < 12; i++) {
        const key = `떠난직원${String(i).padStart(2, '0')}-deadbeef`;
        fs.mkdirSync(path.join(base, key), { recursive: true });
        const stamp = String(i).padStart(2, '0');
        fs.writeFileSync(
          path.join(base, key, `2020-01-01T00-00-${stamp}.000Z.md`),
          `---\nemployee: 떠난${i}\nsavedAt: 2020-01-01T00:00:${stamp}.000Z\n---\n노트`,
        );
      }

      // 현재 직원이 같은 cwd에서 퇴근하면 prune이 돈다.
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '코더 인계' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });

      const dirs = fs
        .readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      // 고아 폴더는 최신 10개만 남고(00·01 삭제), 현재 직원(코더) 폴더는 보존된다.
      expect(dirs.filter((d) => d.startsWith('떠난직원'))).toHaveLength(10);
      expect(dirs.some((d) => d.startsWith('떠난직원00'))).toBe(false);
      expect(dirs.some((d) => d.startsWith('떠난직원01'))).toBe(false);
      expect(dirs.some((d) => d.startsWith('떠난직원11'))).toBe(true);
      expect(dirs.some((d) => d.includes('코더'))).toBe(true);
    });

    it('출근하면 새 인스턴스로 최신 노트 본문을 systemPrompt에 실어 시작한다', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '직전 근무 요약입니다' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });

      await clockIn(store, 1);

      expect(created).toHaveLength(2);
      expect(created[1].startedWithHandoffNote).toContain('직전 근무 요약입니다');
      expect(store.get(1)).toBeDefined();
    });

    it('노트가 없어도 출근은 정상 동작한다', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '검증', cwd: tmpCwd, role: 'staff', offDuty: true },
      ]);
      await rehireSavedEmployees(store, SONNET);
      expect(created).toHaveLength(0); // offDuty: no session started yet

      await clockIn(store, 1);

      expect(created).toHaveLength(1);
      expect(created[0].startedWithHandoffNote).toBeUndefined();
    });

    it('같은 cwd를 쓰는 두 직원은 서로의 인수인계 노트를 읽지 않는다', async () => {
      // 코더가 남긴 노트를 코더 전용 폴더에 미리 심는다.
      const coderDir = handoffDir(tmpCwd, '코더');
      fs.mkdirSync(coderDir, { recursive: true });
      fs.writeFileSync(
        path.join(coderDir, '2020-01-01T00-00-00.000Z.md'),
        '---\nemployee: 코더\n---\n코더만 아는 인수인계',
      );

      // 코더·검증을 같은 cwd에 off-duty로 등록한다.
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '코더', cwd: tmpCwd, role: 'staff', offDuty: true },
        { name: '검증', cwd: tmpCwd, role: 'staff', offDuty: true },
      ]);
      await rehireSavedEmployees(store, SONNET);
      expect(created).toHaveLength(0);

      // 코더가 출근하면 자기 노트를 이어받는다(정상 경로 확인).
      await clockIn(store, 1);
      expect(created[0].startedWithHandoffNote).toContain('코더만 아는 인수인계');

      // 검증이 같은 cwd에서 출근해도 코더의 노트를 물려받지 않는다 — 핵심.
      await clockIn(store, 2);
      expect(created[1].startedWithHandoffNote).toBeUndefined();
    });

    it('rehireSavedEmployees는 offDuty 직원을 세션·캐릭터 없이 명부에만 등록한다', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '코더', cwd: '/work', role: 'staff', offDuty: true },
      ]);

      await rehireSavedEmployees(store, SONNET);

      expect(created).toHaveLength(0);
      expect(store.get(1)).toBeUndefined();
      expect(broadcasts).toContainEqual(
        expect.objectContaining({
          type: 'employeeState',
          employees: [expect.objectContaining({ agentId: 1, duty: 'off' })],
        }),
      );
    });
  });

  describe('이름 중복 방지 (hireEmployee)', () => {
    it('같은 이름이 이미 있으면 거부하고 officeNotice를 보낸다(다른 cwd라도)', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      const result = await hireEmployee(store, '코더', '/other-project', 'staff', SONNET);

      expect(result).toBeUndefined();
      expect(created).toHaveLength(1); // 두 번째 세션은 시작되지 않았다
      expect(broadcasts).toContainEqual({
        type: 'officeNotice',
        level: 'error',
        text: '이미 "코더" 직원이 있습니다. 다른 이름을 쓰세요.',
      });
    });

    it('퇴근(off-duty) 상태의 동명이인도 막는다 — on/off 무관', async () => {
      vi.mocked(readEmployees).mockReturnValueOnce([
        { name: '코더', cwd: '/work', role: 'staff', offDuty: true },
      ]);
      await rehireSavedEmployees(store, SONNET);

      const result = await hireEmployee(store, '코더', '/other-project', 'staff', SONNET);

      expect(result).toBeUndefined();
      expect(created).toHaveLength(0);
    });

    it('거부되어도 명부는 늘어나지 않는다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      await hireEmployee(store, '코더', '/other-project', 'staff', SONNET);

      expect(savedRoster()).toHaveLength(1);
    });

    it('다른 이름이면(같은 cwd라도) 정상적으로 고용된다', async () => {
      await hireEmployee(store, '코더', '/work', 'staff', SONNET);

      const result = await hireEmployee(store, '검증', '/work', 'staff', SONNET);

      expect(result).toBe(2);
      expect(created).toHaveLength(2);
    });
  });

  // Handoff notes hit the real filesystem — see the 'duty' describe above for
  // why these use a real temp cwd rather than the fake '/work' the other
  // tests use.
  describe('fireEmployee(deleteHandoff)', () => {
    let tmpCwd: string;

    beforeEach(() => {
      tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-office-fire-'));
    });

    afterEach(() => {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    });

    it('deleteHandoff: true면 그 직원의 handoff 폴더를 삭제한다', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '오늘 한 일' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });
      const dir = getHandoffDir(tmpCwd, '코더');
      expect(fs.existsSync(dir)).toBe(true);

      fireEmployee(store, 1, undefined, true);

      expect(fs.existsSync(dir)).toBe(false);
    });

    it('deleteHandoff 생략(기본값)이면 노트가 유지된다', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '오늘 한 일' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });
      const dir = getHandoffDir(tmpCwd, '코더');
      expect(fs.existsSync(dir)).toBe(true);

      fireEmployee(store, 1);

      expect(fs.existsSync(dir)).toBe(true);
    });

    it('deleteHandoff: false를 명시해도 노트가 유지된다', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '오늘 한 일' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });
      const dir = getHandoffDir(tmpCwd, '코더');

      fireEmployee(store, 1, undefined, false);

      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe('listHandoffNotes', () => {
    let tmpCwd: string;

    beforeEach(() => {
      tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-office-list-'));
    });

    afterEach(() => {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    });

    it('handoff 폴더 자체가 없으면 빈 배열을 반환한다', () => {
      expect(listHandoffNotes(tmpCwd)).toEqual([]);
    });

    it('하위 폴더들의 최신 노트 frontmatter를 savedAt 내림차순으로 반환한다', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
        clockOut(store, 1);
        created[0].emit({ kind: 'text', text: '코더의 노트' });
        created[0].emit({ kind: 'result', text: '', costUsd: 0 });

        vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
        await hireEmployee(store, '검증', tmpCwd, 'staff', SONNET);
        clockOut(store, 2);
        created[1].emit({ kind: 'text', text: '검증의 노트' });
        created[1].emit({ kind: 'result', text: '', costUsd: 0 });

        const notes = listHandoffNotes(tmpCwd);

        expect(notes.map((n) => n.employee)).toEqual(['검증', '코더']);
        expect(notes.map((n) => n.key)).toEqual([
          path.basename(getHandoffDir(tmpCwd, '검증')),
          path.basename(getHandoffDir(tmpCwd, '코더')),
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('frontmatter를 못 읽는(또는 없는) 폴더는 건너뛴다', () => {
      const dir = path.join(tmpCwd, '.ai-office', 'handoff', 'broken');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '2020-01-01T00-00-00.000Z.md'),
        '내용만 있고 frontmatter가 없음',
      );

      expect(listHandoffNotes(tmpCwd)).toEqual([]);
    });
  });

  describe('hireEmployee(handoffFromKey) — 인계 이어받기', () => {
    let tmpCwd: string;

    beforeEach(() => {
      tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-office-resume-'));
    });

    afterEach(() => {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    });

    it('주어진 키 폴더의 최신 노트를 실어 시작한다 — 다른 이름 직원이 이어받는 경우도 포함', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '코더가 남긴 인수인계' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });
      // 해임하되 노트는 남긴다 — 다음 고용에서 골라 이어받을 수 있어야 한다.
      fireEmployee(store, 1, undefined, false);

      const [note] = listHandoffNotes(tmpCwd);
      expect(note.employee).toBe('코더');

      // 완전히 다른 이름의 새 직원이 그 키를 지목해 이어받는다(Case C).
      await hireEmployee(
        store,
        '검증',
        tmpCwd,
        'staff',
        SONNET,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        note.key,
      );

      expect(created[1].startedWithHandoffNote).toContain('코더가 남긴 인수인계');
    });

    it('handoffFromKey를 안 주면 평범한 첫 근무로 시작한다(노트 없음)', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);

      expect(created[0].startedWithHandoffNote).toBeUndefined();
    });

    it('같은 이름 자신의 키를 지정해도 이어받을 수 있다(같은 사람이 다시 고용되는 경우)', async () => {
      await hireEmployee(store, '코더', tmpCwd, 'staff', SONNET);
      clockOut(store, 1);
      created[0].emit({ kind: 'text', text: '내가 남긴 노트' });
      created[0].emit({ kind: 'result', text: '', costUsd: 0 });
      fireEmployee(store, 1, undefined, false);

      const [note] = listHandoffNotes(tmpCwd);

      await hireEmployee(
        store,
        '코더',
        tmpCwd,
        'staff',
        SONNET,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        note.key,
      );

      expect(created[1].startedWithHandoffNote).toContain('내가 남긴 노트');
    });

    it('handoffFromKey가 handoff 폴더를 벗어나면(경로 탈출) 노트를 읽지 않는다', async () => {
      // handoff 폴더 밖에 미끼 노트를 심는다 — 가드가 없으면 이걸 읽어버린다.
      const evilDir = path.join(tmpCwd, '.ai-office', 'evil');
      fs.mkdirSync(evilDir, { recursive: true });
      fs.writeFileSync(path.join(evilDir, 'x.md'), '---\nemployee: 침입\nsavedAt: 2020\n---\n비밀');

      await hireEmployee(
        store,
        '코더',
        tmpCwd,
        'staff',
        SONNET,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '../evil',
      );

      expect(created[0].startedWithHandoffNote).toBeUndefined();
    });
  });
});
