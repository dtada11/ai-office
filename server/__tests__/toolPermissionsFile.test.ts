/**
 * toolPermissions.ts, the half that touches disk: load/save and the four
 * mutators built on them, plus checkAutoApproval's field extraction.
 *
 * Kept apart from toolPermissions.test.ts on purpose — that suite covers the
 * pure functions and needs no HOME redirect, while every test here reads or
 * writes ~/.pixel-agents/tool-permissions.json for real.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  addPermission,
  checkAutoApproval,
  clearEmployeePermissions,
  loadToolPermissions,
  removePermission,
  saveToolPermissions,
  type ToolPermission,
  type ToolPermissionsData,
} from '../src/toolPermissions.js';
import { restoreHome } from './testHome.js';

// Before the imports, not in beforeEach: toolPermissions.ts resolves the
// permissions path from $HOME once, at module load. A redirect that lands any
// later leaves the module pointed at the developer's real
// ~/.pixel-agents/tool-permissions.json — and this suite writes to it.
const { tmpHome, savedHome } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { redirectHome } = await import('./testHome.js');

  const dir = mkdtempSync(join(tmpdir(), 'tool-permissions-file-'));
  return { tmpHome: dir, savedHome: redirectHome(dir) };
});

const PERMISSIONS_DIR = path.join(tmpHome, '.pixel-agents');
const PERMISSIONS_FILE = path.join(PERMISSIONS_DIR, 'tool-permissions.json');

function permission(tool: string, match: 'exact' | 'dirPrefix', value: string): ToolPermission {
  return { tool, match, value, addedAt: '2026-07-17T14:32:00.000Z' };
}

/** Put a file on disk exactly as given — including shapes the real saver would
 *  never produce, which is the point for the load tests. */
function writeRaw(content: string): void {
  fs.mkdirSync(PERMISSIONS_DIR, { recursive: true });
  fs.writeFileSync(PERMISSIONS_FILE, content, 'utf-8');
}

const EMPTY: ToolPermissionsData = { version: 1, byEmployee: {} };

afterEach(() => {
  fs.rmSync(PERMISSIONS_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

afterAll(() => {
  restoreHome(savedHome);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('loadToolPermissions', () => {
  it('파일이 없으면 빈 구조 — 첫 실행의 정상 상태다', () => {
    expect(loadToolPermissions()).toEqual(EMPTY);
  });

  // fail-closed: 깨진 파일에 대한 올바른 반응은 "자동승인 없음"이지 크래시가 아니다.
  // 여기서 던지면 서버가 뜨지 못하고, 사용자는 손으로 파일을 지우기 전엔 사무실을 못 연다.
  it('JSON이 깨졌으면 빈 구조 — 던지지 않는다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeRaw('{ this is not json');

    expect(() => loadToolPermissions()).not.toThrow();
    expect(loadToolPermissions()).toEqual(EMPTY);
  });

  // 미래의 version 2 파일을 version 1 코드가 제 멋대로 해석하면, 뜻이 바뀐 필드를
  // 근거로 자동승인이 나갈 수 있다. 모르는 버전은 읽지 않는 게 맞다.
  it('version이 1이 아니면 빈 구조 — 모르는 스키마는 신뢰하지 않는다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeRaw(JSON.stringify({ version: 2, byEmployee: { 어떤키: { allow: [] } } }));

    expect(loadToolPermissions()).toEqual(EMPTY);
  });

  it('byEmployee가 객체가 아니면 빈 구조', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeRaw(JSON.stringify({ version: 1, byEmployee: '망가짐' }));

    expect(loadToolPermissions()).toEqual(EMPTY);
  });
});

describe('saveToolPermissions', () => {
  it('디렉터리가 없으면 만들고 쓴다 — 첫 허용이 조용히 사라지면 안 된다', () => {
    expect(fs.existsSync(PERMISSIONS_DIR)).toBe(false);

    saveToolPermissions({ version: 1, byEmployee: { 어떤키: { allow: [] } } });

    expect(loadToolPermissions()).toEqual({ version: 1, byEmployee: { 어떤키: { allow: [] } } });
  });

  // temp+rename으로 쓴다. rename이 빠지거나 실패하면 .tmp가 남는데, 그건 곧
  // 진짜 파일이 갱신되지 않았다는 뜻이다 — 잔재 자체가 신호다.
  it('쓰고 나면 .tmp 잔재가 남지 않는다', () => {
    saveToolPermissions({ version: 1, byEmployee: {} });

    expect(fs.readdirSync(PERMISSIONS_DIR)).toEqual(['tool-permissions.json']);
  });
});

describe('addPermission', () => {
  it('처음 보는 키면 버킷을 만들고 넣는다', () => {
    expect(addPermission('어떤키', permission('Bash', 'exact', 'npm run test'))).toBe(true);

    expect(loadToolPermissions().byEmployee['어떤키'].allow).toEqual([
      permission('Bash', 'exact', 'npm run test'),
    ]);
  });

  it('중복이면 false를 주고 파일을 건드리지 않는다', () => {
    addPermission('어떤키', permission('Bash', 'exact', 'npm run test'));
    const before = fs.readFileSync(PERMISSIONS_FILE, 'utf-8');

    expect(addPermission('어떤키', permission('Bash', 'exact', 'npm run test'))).toBe(false);

    expect(fs.readFileSync(PERMISSIONS_FILE, 'utf-8')).toBe(before);
  });

  it('같은 도구라도 value가 다르면 중복이 아니다 — 둘 다 남는다', () => {
    addPermission('어떤키', permission('Bash', 'exact', 'npm run test'));

    expect(addPermission('어떤키', permission('Bash', 'exact', 'npm run build'))).toBe(true);

    expect(loadToolPermissions().byEmployee['어떤키'].allow).toHaveLength(2);
  });
});

describe('removePermission', () => {
  it('없는 키면 false — 엉뚱한 버킷이 생기지도 않는다', () => {
    expect(removePermission('없는키', 'Bash', 'exact', 'npm run test')).toBe(false);

    expect(loadToolPermissions().byEmployee['없는키']).toBeUndefined();
  });

  // 도구·match·value 셋이 함께 한 항목을 지목한다. 하나라도 다르면 다른 항목이다.
  it.each([
    ['도구가 다르면', 'Read', 'exact', 'npm run test'],
    ['match가 다르면', 'Bash', 'dirPrefix', 'npm run test'],
    ['value가 다르면', 'Bash', 'exact', 'npm run build'],
  ])('%s 지우지 않는다', (_label, tool, match, value) => {
    addPermission('어떤키', permission('Bash', 'exact', 'npm run test'));

    expect(removePermission('어떤키', tool, match, value)).toBe(false);

    expect(loadToolPermissions().byEmployee['어떤키'].allow).toHaveLength(1);
  });

  // 현행 동작을 못 박아 둔다: 마지막 항목을 지워도 키는 빈 allow와 함께 남는다.
  // 곧 만들 "고아 스윕"은 이렇게 남은 빈 키가 존재한다는 전제 위에 설계된다.
  it('마지막 항목을 지워도 빈 allow를 가진 키는 남는다', () => {
    addPermission('어떤키', permission('Bash', 'exact', 'npm run test'));

    expect(removePermission('어떤키', 'Bash', 'exact', 'npm run test')).toBe(true);

    expect(loadToolPermissions().byEmployee['어떤키']).toEqual({ allow: [] });
  });
});

describe('clearEmployeePermissions', () => {
  it('키를 통째로 지운다 — 빈 allow가 아니라 키 자체가 없어진다', () => {
    addPermission('어떤키', permission('Bash', 'exact', 'npm run test'));

    clearEmployeePermissions('어떤키');

    expect(loadToolPermissions().byEmployee).toEqual({});
  });

  it('없는 키에도 터지지 않는다', () => {
    expect(() => clearEmployeePermissions('없는키')).not.toThrow();
  });

  it('다른 직원의 키는 건드리지 않는다', () => {
    addPermission('갑', permission('Bash', 'exact', 'npm run test'));
    addPermission('을', permission('Bash', 'exact', 'npm run build'));

    clearEmployeePermissions('갑');

    expect(loadToolPermissions().byEmployee['을'].allow).toEqual([
      permission('Bash', 'exact', 'npm run build'),
    ]);
  });
});

describe('checkAutoApproval', () => {
  // 도구마다 "무엇을 허용했는지"가 담긴 입력 필드가 다르다. 엉뚱한 필드를 보면
  // 허용한 적 없는 호출이 통과하거나(fail-open), 허용한 호출이 매번 다시 묻는다.
  it.each([
    ['Read', 'file_path'],
    ['Edit', 'file_path'],
    ['Write', 'file_path'],
  ])('%s는 file_path를 본다', (tool, field) => {
    addPermission('어떤키', permission(tool, 'exact', 'F:/Projects/a.ts'));

    expect(checkAutoApproval('어떤키', tool, { [field]: 'F:/Projects/a.ts' })).toEqual(
      permission(tool, 'exact', 'F:/Projects/a.ts'),
    );
  });

  it.each([
    ['Grep', 'path'],
    ['Glob', 'path'],
  ])('%s는 path를 본다', (tool, field) => {
    addPermission('어떤키', permission(tool, 'exact', 'F:/Projects'));

    expect(checkAutoApproval('어떤키', tool, { [field]: 'F:/Projects' })).toEqual(
      permission(tool, 'exact', 'F:/Projects'),
    );
  });

  it('Bash는 command를 본다', () => {
    addPermission('어떤키', permission('Bash', 'exact', 'npm run test'));

    expect(checkAutoApproval('어떤키', 'Bash', { command: 'npm run test' })).toEqual(
      permission('Bash', 'exact', 'npm run test'),
    );
  });

  it('Read에 file_path가 없으면 null — 볼 값이 없으면 통과시키지 않는다', () => {
    addPermission('어떤키', permission('Read', 'exact', 'F:/Projects/a.ts'));

    expect(checkAutoApproval('어떤키', 'Read', { path: 'F:/Projects/a.ts' })).toBeNull();
  });

  // fail-closed: 어떤 필드가 그 도구의 "범위"인지 모르면 자동승인 대상이 아니다.
  // 여기서 아무 필드나 집어 비교하면, 사용자가 승인한 적 없는 도구가 통과한다.
  it('알 수 없는 도구는 항목이 있어도 null', () => {
    addPermission('어떤키', permission('WebFetch', 'exact', 'https://example.com'));

    expect(checkAutoApproval('어떤키', 'WebFetch', { url: 'https://example.com' })).toBeNull();
  });

  it('허용목록이 없는 키는 null', () => {
    expect(checkAutoApproval('없는키', 'Bash', { command: 'npm run test' })).toBeNull();
  });

  it('다른 직원의 허용은 통하지 않는다', () => {
    addPermission('갑', permission('Bash', 'exact', 'npm run test'));

    expect(checkAutoApproval('을', 'Bash', { command: 'npm run test' })).toBeNull();
  });

  it('dirPrefix는 하위 파일을 통과시킨다', () => {
    addPermission('어떤키', permission('Read', 'dirPrefix', 'F:/Projects/ai-office'));

    expect(
      checkAutoApproval('어떤키', 'Read', { file_path: 'F:/Projects/ai-office/server/src/a.ts' }),
    ).not.toBeNull();
  });

  // 경계를 문자열 접두사로만 보면 ai-office-secret 이 ai-office 허용으로 열린다.
  it('dirPrefix는 이름만 겹치는 옆 폴더를 통과시키지 않는다', () => {
    addPermission('어떤키', permission('Read', 'dirPrefix', 'F:/Projects/ai-office'));

    expect(
      checkAutoApproval('어떤키', 'Read', { file_path: 'F:/Projects/ai-office-secret/a.ts' }),
    ).toBeNull();
  });

  // 확정된 보안 설계다. Bash exact는 명령 전체가 같을 때만 통과한다 — 접두사로
  // 통하면 "npm run test"를 한 번 허용해준 사용자가 그 뒤에 붙은 무엇이든 허용한 셈이 된다.
  it('Bash exact에 접두사는 통하지 않는다 — 뒤에 붙인 명령이 묻어 들어오면 안 된다', () => {
    addPermission('어떤키', permission('Bash', 'exact', 'npm run test'));

    expect(checkAutoApproval('어떤키', 'Bash', { command: 'npm run test; rm -rf /' })).toBeNull();
  });
});
