/**
 * Whose permissions are whose — the identity an allowlist is filed under, seen
 * only through the public API (allowlistKeyFor / listAllowlistTargets /
 * checkAutoApproval).
 *
 * Nothing here asserts the SHAPE of a key. The key format is an implementation
 * detail that is expected to change; what must not change is the behavior — a
 * departed employee's allowances never reach the next person to hold that name,
 * and an employee's own allowances survive every path that legitimately keeps
 * them on the roster (restart, clock-out, off-duty restore, any later save).
 *
 * Runs against the REAL employees registry and the REAL permissions file under a
 * temp HOME; only the SDK-backed session and the roster file are stubbed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { EmployeeEvent, EmployeeHost } from '../src/employee.js';
import type { SavedEmployee } from '../src/employeePersistence.js';
import { readEmployees, writeEmployees } from '../src/employeePersistence.js';
import {
  allowlistKeyFor,
  clockIn,
  clockOut,
  disposeEmployees,
  fireEmployee,
  hireEmployee,
  listAllowlistTargets,
  listHandoffNotes,
  pruneOrphanedPermissions,
  rehireSavedEmployees,
  renameEmployee,
} from '../src/employees.js';
import {
  addPermission,
  checkAutoApproval,
  loadToolPermissions,
  type ToolPermission,
} from '../src/toolPermissions.js';
import { restoreHome } from './testHome.js';

// Before the imports, not in beforeEach: toolPermissions.ts resolves the
// permissions path from $HOME once, at module load. A redirect that lands any
// later leaves the module pointed at the developer's real
// ~/.pixel-agents/tool-permissions.json — and this suite writes to it.
const { tmpHome, savedHome, sessions } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { redirectHome } = await import('./testHome.js');

  const dir = mkdtempSync(join(tmpdir(), 'permission-identity-'));
  return {
    tmpHome: dir,
    savedHome: redirectHome(dir),
    sessions: [] as Array<{ name: string; host: EmployeeHost; start: ReturnType<typeof vi.fn> }>,
  };
});

// No SDK, no child process. The host callbacks are kept so a test can drive the
// session's own events — the crash path (B-2) and the clock-out handoff (B-4)
// only exist as reactions to them.
vi.mock('../src/employee.js', () => {
  class ClaudeEmployee {
    sessionId = '';
    start = vi.fn(async () => {});
    setModel = vi.fn(async () => {});
    send = vi.fn();
    stop = vi.fn();
    constructor(
      public name: string,
      public cwd: string,
      public host: EmployeeHost,
    ) {
      sessions.push(this);
    }
  }
  return { ClaudeEmployee };
});

vi.mock('../src/employeePersistence.js', () => ({
  readEmployees: vi.fn((): SavedEmployee[] => []),
  writeEmployees: vi.fn(),
}));

const SONNET = 'claude-sonnet-5';
const WORK = path.join(tmpHome, 'work');
/** A scaffolded team folder: the root, and the one subfolder a teammate is
 *  actually hired into. Everything outside TEAM_ROOT is another project. */
const TEAM_ROOT = path.join(tmpHome, 'team');
const TEAM_TESTS = path.join(TEAM_ROOT, 'tests');
const TEAM_SRC = path.join(TEAM_ROOT, 'src');

function permission(tool: string, match: 'exact' | 'dirPrefix', value: string): ToolPermission {
  return { tool, match, value, addedAt: '2026-07-17T14:32:00.000Z' };
}

/** The live session for this employee — the most recent one, since a clock-in
 *  builds a fresh instance rather than restarting the old one. */
function sessionFor(name: string) {
  const matching = sessions.filter((s) => s.name === name);
  return matching[matching.length - 1];
}

function fire(name: string, event: EmployeeEvent): void {
  sessionFor(name).host.onEvent(event);
}

/** The roster exactly as saveStaff() last wrote it. Tests restart from this
 *  rather than a hand-written roster on purpose: if the whitelist mapper drops a
 *  field the identity needs, a hand-written fixture would hide it. */
function savedRoster(): SavedEmployee[] {
  const calls = vi.mocked(writeEmployees).mock.calls;
  return calls[calls.length - 1][0];
}

/** The identity the server resolves for a name right now, via the same public
 *  path a client request takes: agentId in, key out. Null when nobody by that
 *  name works here. */
function keyOf(name: string): string | null {
  const target = listAllowlistTargets().find((t) => t.name === name);
  return target ? allowlistKeyFor(target.agentId) : null;
}

/** Would this employee's Bash command run without asking the user? */
function autoApproved(name: string, command: string): boolean {
  const key = keyOf(name);
  return key !== null && checkAutoApproval(key, 'Bash', { command }) !== null;
}

/** Would this employee's look at a path go through without asking? Read and
 *  Grep/Glob are asked separately because checkAutoApproval reads a different
 *  input field per tool — file_path vs path. */
function canRead(name: string, filePath: string): boolean {
  const key = keyOf(name);
  return key !== null && checkAutoApproval(key, 'Read', { file_path: filePath }) !== null;
}

function canSearch(name: string, tool: 'Grep' | 'Glob', dir: string): boolean {
  const key = keyOf(name);
  return key !== null && checkAutoApproval(key, tool, { path: dir }) !== null;
}

/** Every rule filed under this employee, whatever the tool. */
function permissionsOf(name: string): ToolPermission[] {
  const key = keyOf(name);
  return key === null ? [] : (loadToolPermissions().byEmployee[key]?.allow ?? []);
}

/** hireEmployee's tail is a run of optional positional args; a team hire only
 *  ever sets the last one. Named here so a future insertion breaks loudly. */
function hireInTeam(
  store: AgentStateStore,
  name: string,
  cwd: string,
  teamRoot: string | undefined,
): Promise<number | undefined> {
  return hireEmployee(
    store,
    name,
    cwd,
    'staff',
    SONNET,
    undefined, // runtime
    undefined, // ownProvider
    undefined, // roleLabel
    undefined, // persona
    undefined, // palette
    undefined, // hueShift
    undefined, // handoffFromKey
    undefined, // savedPermissionKey
    teamRoot,
  );
}

/** Close the office and open it again from a saved roster — the restart path. */
async function restart(roster: SavedEmployee[]): Promise<AgentStateStore> {
  disposeEmployees();
  vi.mocked(readEmployees).mockReturnValue(roster);
  const store = new AgentStateStore();
  await rehireSavedEmployees(store, SONNET);
  return store;
}

/** Clock out and let the handoff summary finish, so duty settles to 'off' and
 *  the note is written — what clockOut() alone does not do (it only asks). */
function clockOutFully(store: AgentStateStore, agentId: number, name: string, note: string): void {
  clockOut(store, agentId);
  fire(name, { kind: 'text', text: note });
  fire(name, { kind: 'result', text: '', costUsd: 0 });
}

beforeEach(() => {
  vi.mocked(readEmployees).mockReturnValue([]);
});

afterEach(() => {
  disposeEmployees(); // the staff map is module state — the next test starts empty
  sessions.length = 0;
  fs.rmSync(path.join(tmpHome, '.pixel-agents'), { recursive: true, force: true });
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.rmSync(TEAM_ROOT, { recursive: true, force: true });
  vi.clearAllMocks();
});

afterAll(() => {
  restoreHome(savedHome);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('떠난 직원의 권한은 물려주지 않는다', () => {
  // 실측 재현된 버그다. 이름에서 키를 뽑는 한, 같은 이름으로 뽑은 신입은
  // 전임자가 쌓아둔 허용을 그대로 물려받는다 — 사용자는 이 신입에게 아무것도
  // 허용해준 적이 없는데도.
  it('B-1: 해임 → 동명 재고용 — 전임자의 허용이 붙지 않는다', async () => {
    const store = new AgentStateStore();
    const agentId = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);
    addPermission(allowlistKeyFor(agentId!)!, permission('Bash', 'exact', 'npm run deploy'));
    fireEmployee(store, agentId!);

    const rehired = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);

    expect(
      checkAutoApproval(allowlistKeyFor(rehired!)!, 'Bash', { command: 'npm run deploy' }),
    ).toBeNull();
  });

  // 해임만 막아서는 부족하다. duty:'on'인 채 세션이 죽으면 onEvent의 'ended'가
  // 해임을 거치지 않고 staff에서 지운다 — "해임 시 키를 지운다"는 한 줄짜리
  // 해법이 이 경로 때문에 기각됐다.
  it('B-2: 세션 사망 → 동명 재고용 — 전임자의 허용이 붙지 않는다', async () => {
    const store = new AgentStateStore();
    const agentId = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);
    addPermission(allowlistKeyFor(agentId!)!, permission('Bash', 'exact', 'npm run deploy'));

    fire('사이트담당', { kind: 'ended', text: '세션 오류' });

    const rehired = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);

    expect(
      checkAutoApproval(allowlistKeyFor(rehired!)!, 'Bash', { command: 'npm run deploy' }),
    ).toBeNull();
  });
});

describe('재직 중인 직원의 권한은 살아남는다', () => {
  // 9dd36bd 사건: 재시작마다 전 직원의 허용목록이 증발했다. 세션 id로 키를
  // 잡으면 이렇게 된다 — 재시작은 세션을 전부 새로 발급하기 때문이다.
  it('B-3: 재시작 — 로스터에서 복원된 직원의 허용이 그대로다', async () => {
    const store = new AgentStateStore();
    const agentId = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);
    addPermission(allowlistKeyFor(agentId!)!, permission('Bash', 'exact', 'npm run deploy'));

    await restart(savedRoster());

    expect(autoApproved('사이트담당', 'npm run deploy')).toBe(true);
  });

  it('B-4: 퇴근 → 출근 — 허용이 유지된다', async () => {
    const store = new AgentStateStore();
    const agentId = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);
    addPermission(allowlistKeyFor(agentId!)!, permission('Bash', 'exact', 'npm run deploy'));

    clockOutFully(store, agentId!, '사이트담당', '오늘 한 일');
    await clockIn(store, agentId!);

    expect(autoApproved('사이트담당', 'npm run deploy')).toBe(true);
  });

  // 퇴근한 직원은 재시작 때 hireEmployee를 아예 지나가지 않는다 —
  // rehireSavedEmployees가 registerOffDutyStaff로 샌다. 키 발급을
  // hireEmployee에만 붙이면 퇴근 상태로 저장된 직원 전원이 재시작 후 허용을 잃는다.
  it('B-5: 퇴근 상태로 재시작 — offDuty 복원 경로도 허용을 갖는다', async () => {
    const store = new AgentStateStore();
    const agentId = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);
    addPermission(allowlistKeyFor(agentId!)!, permission('Bash', 'exact', 'npm run deploy'));
    clockOutFully(store, agentId!, '사이트담당', '오늘 한 일');

    const roster = savedRoster();
    expect(roster[0].offDuty).toBe(true); // 이 테스트가 겨누는 경로가 맞는지부터

    await restart(roster);

    expect(autoApproved('사이트담당', 'npm run deploy')).toBe(true);
  });

  // saveStaff는 필드를 손으로 나열하는 화이트리스트 매퍼다. 신원이 로스터에
  // 실려야 하는데 매퍼에 그 필드가 없으면, 다음 저장 아무거나 한 번에 조용히 증발한다.
  it('B-6: saveStaff 라운드트립 — 저장이 한 번 더 일어나도 신원이 남는다', async () => {
    const store = new AgentStateStore();
    const agentId = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);
    addPermission(allowlistKeyFor(agentId!)!, permission('Bash', 'exact', 'npm run deploy'));

    const restarted = await restart(savedRoster());
    const rehiredId = listAllowlistTargets().find((t) => t.name === '사이트담당')!.agentId;
    renameEmployee(restarted, rehiredId, '웹 담당'); // 저장을 한 번 더 일으킨다
    await restart(savedRoster());

    expect(autoApproved('사이트담당', 'npm run deploy')).toBe(true);
  });
});

// 키를 이름에서 떼어내면, 떠난 직원의 허용목록은 아무도 열쇠를 갖지 않은 채
// 파일에 남는다. 죽은 항목이라 위험하진 않지만, 쌓이는 건 사실이라 치운다.
describe('고아 청소 — 아무도 쓸 수 없는 항목만 지운다', () => {
  // 로스터가 비었다는 건 "직원이 없다"일 수도, "아직 복원 전"일 수도 있다. 둘을
  // 구분할 방법이 없으므로 안전한 쪽으로 실패한다 — 여기서 지워버리면 사무실을
  // 열 때마다 전 직원의 자동 허용이 조용히 증발한다.
  it('B-7: 로스터가 비어 있으면 아무것도 지우지 않는다', async () => {
    addPermission('아무개-00000000', permission('Bash', 'exact', 'npm run deploy'));
    await restart([]);

    pruneOrphanedPermissions();

    expect(loadToolPermissions().byEmployee['아무개-00000000']).toEqual({
      allow: [permission('Bash', 'exact', 'npm run deploy')],
    });
  });

  // 퇴근은 퇴사가 아니다. offDuty 직원도 로스터에 있는 재직자이므로 그 키는
  // 살아있는 명단에 들어야 한다 — 아니면 하룻밤 자고 온 직원이 허용을 잃는다.
  it('B-8: 재직 중인 키는 남기고, 로스터에 없는 키만 지운다', async () => {
    const store = new AgentStateStore();
    const agentId = await hireEmployee(store, '사이트담당', WORK, 'staff', SONNET);
    addPermission(allowlistKeyFor(agentId!)!, permission('Bash', 'exact', 'npm run deploy'));
    clockOutFully(store, agentId!, '사이트담당', '오늘 한 일');
    const roster = savedRoster();
    expect(roster[0].offDuty).toBe(true); // 이 테스트가 겨누는 경로가 맞는지부터

    addPermission('떠난사람-deadbeef', permission('Bash', 'exact', 'rm -rf /'));

    await restart(roster);
    pruneOrphanedPermissions();

    expect(autoApproved('사이트담당', 'npm run deploy')).toBe(true);
    expect(loadToolPermissions().byEmployee['떠난사람-deadbeef']).toBeUndefined();
  });
});

// 팀 폴더로 고용하면 팀 루트 읽기 권한이 자동으로 붙는다. 46번 재현실험에서
// 증명된 것의 배관: 담당폴더(tests) 밖의 src·docs를 읽어야 하는 검증담당이
// 파일마다 결재를 기다리다 죽었다. 손으로 발급했더니 살아났고, 이제 고용이 한다.
describe('팀 고용 — 팀 루트 읽기 권한 자동 발급', () => {
  it('T-1: teamRoot를 주고 고용 → 팀 루트 밑 파일에 Read·Grep·Glob 셋 다 승인', async () => {
    const store = new AgentStateStore();
    await hireInTeam(store, '검증담당', TEAM_TESTS, TEAM_ROOT);

    // 자기 담당 폴더(cwd)가 아니라 남의 폴더를 읽는 것이 요점이다
    expect(canRead('검증담당', path.join(TEAM_SRC, 'employees.ts'))).toBe(true);
    expect(canSearch('검증담당', 'Grep', TEAM_SRC)).toBe(true);
    expect(canSearch('검증담당', 'Glob', TEAM_SRC)).toBe(true);
  });

  // 🔴 오늘 사람이 두 번 틀린 자리다. checkAutoApproval은 도구 이름을 먼저 거른다
  // (`if (perm.tool !== toolName) continue`) — Read 허용은 Grep을 영원히 안 덮는다.
  // 그래서 3건이고, 이 테스트가 그 3건을 1건으로 줄이려는 다음 사람을 막는다.
  it('T-2: Read 규칙은 Grep을 덮지 않는다 — 그래서 발급이 3건이다', async () => {
    const store = new AgentStateStore();
    const agentId = await hireEmployee(store, '읽기만', TEAM_TESTS, 'staff', SONNET);
    // Read 하나만 손으로 발급 — 자동발급이 Read 1건이었다면 이 상태였을 것이다
    addPermission(allowlistKeyFor(agentId!)!, permission('Read', 'dirPrefix', TEAM_ROOT));

    expect(canRead('읽기만', path.join(TEAM_SRC, 'employees.ts'))).toBe(true);
    expect(canSearch('읽기만', 'Grep', TEAM_SRC)).toBe(false);
    expect(canSearch('읽기만', 'Glob', TEAM_SRC)).toBe(false);
  });

  // 온보딩 첫 고용·손 고용·퇴근자 복귀가 전부 teamRoot 없이 여기로 온다.
  // 그 경로들이 조용히 권한을 얻으면, 사용자가 허락한 적 없는 허용이 생긴다.
  it('T-3: teamRoot 없이 고용 → 권한 0건', async () => {
    const store = new AgentStateStore();
    await hireInTeam(store, '손고용', TEAM_TESTS, undefined);

    expect(permissionsOf('손고용')).toEqual([]);
    expect(canRead('손고용', path.join(TEAM_SRC, 'employees.ts'))).toBe(false);
  });

  // 서버는 클라이언트가 보낸 teamRoot를 그냥 믿지 않는다. "이 사람이 실제로 그
  // 폴더에서 일한다"는 것 외엔 아무것도 안 믿는 가드 — 틀려도 과다 허용 쪽으로는
  // 안 틀린다.
  it('T-4: cwd가 teamRoot 밖이면 → 권한 0건 (클라이언트 주장을 안 믿는다)', async () => {
    const store = new AgentStateStore();
    await hireInTeam(store, '남의사람', WORK, TEAM_ROOT);

    expect(permissionsOf('남의사람')).toEqual([]);
    expect(canRead('남의사람', path.join(TEAM_SRC, 'employees.ts'))).toBe(false);
  });

  // 경계가 실재하는지 — 팀 루트를 열어준 것이지 디스크를 열어준 게 아니다.
  it('T-5: 팀 루트 밖 파일은 여전히 승인 안 된다', async () => {
    const store = new AgentStateStore();
    await hireInTeam(store, '검증담당', TEAM_TESTS, TEAM_ROOT);

    expect(canRead('검증담당', path.join(WORK, 'secret.env'))).toBe(false);
    expect(canSearch('검증담당', 'Grep', WORK)).toBe(false);
    // 이름이 팀 루트로 시작할 뿐인 형제 폴더도 남이다 (dirPrefix는 경계 인식)
    expect(canRead('검증담당', `${TEAM_ROOT}-backup/secret.env`)).toBe(false);
  });

  // 읽기를 넓히는 것이지 쓰기·실행을 넓히는 게 아니다. 발급 목록에 Edit·Write·
  // Bash가 슬며시 끼는 것을 막는다.
  it('T-6: 쓰기·실행은 발급하지 않는다 — 읽기 3종뿐', async () => {
    const store = new AgentStateStore();
    await hireInTeam(store, '검증담당', TEAM_TESTS, TEAM_ROOT);

    expect(
      permissionsOf('검증담당')
        .map((p) => p.tool)
        .sort(),
    ).toEqual(['Glob', 'Grep', 'Read']);
    expect(
      checkAutoApproval(keyOf('검증담당')!, 'Write', {
        file_path: path.join(TEAM_SRC, 'employees.ts'),
      }),
    ).toBeNull();
    expect(autoApproved('검증담당', 'rm -rf /')).toBe(false);
  });

  // 팀은 4~5명이고 사용자는 같은 로스터에서 연속으로 고용한다. 첫 명만 권한을
  // 받고 나머지가 조용히 못 받는 것이 이 배관의 대표적 실패 모양이다.
  it('T-7: 같은 로스터에서 연속 고용 — 전원이 권한을 받는다', async () => {
    const store = new AgentStateStore();
    await hireInTeam(store, '개발담당', path.join(TEAM_ROOT, 'src'), TEAM_ROOT);
    await hireInTeam(store, '검증담당', TEAM_TESTS, TEAM_ROOT);
    await hireInTeam(store, '팀장', TEAM_ROOT, TEAM_ROOT); // cwd == teamRoot 인 사람도 있다

    for (const name of ['개발담당', '검증담당', '팀장']) {
      expect(canSearch(name, 'Grep', TEAM_SRC)).toBe(true);
    }
  });

  // 재시작은 hireEmployee를 다시 지나가지만 teamRoot는 로스터에 없다(SavedEmployee에
  // 안 넣었다). 그래도 권한이 살아야 한다 — 버킷은 permissionKey로 살아있고 그 키가
  // replay되기 때문이다. 이게 성립해야 "재발급 불필요"라는 설계가 맞다.
  it('T-8: 재시작 — teamRoot가 로스터에 없어도 팀 권한이 살아남는다', async () => {
    const store = new AgentStateStore();
    await hireInTeam(store, '검증담당', TEAM_TESTS, TEAM_ROOT);

    await restart(savedRoster());

    expect(canSearch('검증담당', 'Grep', TEAM_SRC)).toBe(true);
  });
});

// 지식은 넘기고 권한은 안 넘긴다 — 권한 키 분리의 요점이 이것이다.
it('B-9: 다른 이름의 신입이 전임자 노트를 이어받아도, 권한은 이어받지 않는다', async () => {
  const store = new AgentStateStore();
  const agentId = await hireEmployee(store, '전임자', WORK, 'staff', SONNET);
  addPermission(allowlistKeyFor(agentId!)!, permission('Bash', 'exact', 'npm run deploy'));
  clockOutFully(store, agentId!, '전임자', 'DB 마이그레이션 하다 말았습니다');
  fireEmployee(store, agentId!);

  const notes = listHandoffNotes(WORK);
  expect(notes).toHaveLength(1);

  const rookie = await hireEmployee(
    store,
    '후임자',
    WORK,
    'staff',
    SONNET,
    undefined, // runtime
    undefined, // ownProvider
    undefined, // roleLabel
    undefined, // persona
    undefined, // palette
    undefined, // hueShift
    notes[0].key,
  );

  // 지식은 넘어간다 (기존 설계, 그대로 살아야 한다)
  expect(sessionFor('후임자').start).toHaveBeenCalledWith(
    SONNET,
    undefined,
    undefined,
    expect.stringContaining('DB 마이그레이션'),
    expect.any(Function), // 팀원의 보드 note 콜백
  );
  // 권한은 넘어가지 않는다
  expect(
    checkAutoApproval(allowlistKeyFor(rookie!)!, 'Bash', { command: 'npm run deploy' }),
  ).toBeNull();
});
