import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import type { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import type { EmployeeEvent, PermissionAsk } from '../src/employee.js';
import type { SavedEmployee } from '../src/employeePersistence.js';
import { readEmployees, writeEmployees } from '../src/employeePersistence.js';
import {
  clockIn,
  clockOut,
  disposeEmployees,
  fireEmployee,
  getPendingPermissionRequests,
  hireEmployee,
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
        _delegation?: unknown,
        persona?: string,
        handoffNote?: string,
      ): Promise<void> => {
        this.startedWith = model;
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

      resolveEmployeePermission(ASK.requestId, true);

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

      resolveEmployeePermission(ASK.requestId, false);

      expect(getPendingPermissionRequests()).toEqual([{ agentId: 2, ask: second }]);
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

    function handoffDir(cwd: string): string {
      return path.join(cwd, '.ai-office', 'handoff');
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
});
