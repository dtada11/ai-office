/**
 * The settings panel's "자동 허용" section, server side: `listAllowlist` and
 * `removeFromAllowlist`.
 *
 * Runs against the REAL employees registry (only the SDK-backed session and the
 * roster file are stubbed) and the REAL permissions file under a temp HOME. The
 * point of both messages is who the server thinks each employee is, so a mocked
 * employees.js would test the mock's idea of the roster and nothing else.
 */

import * as fs from 'fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { ClientMessageContext } from '../src/clientMessageHandler.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import type { SavedEmployee } from '../src/employeePersistence.js';
import { readEmployees } from '../src/employeePersistence.js';
import { disposeEmployees, listAllowlistTargets, rehireSavedEmployees } from '../src/employees.js';
import { addPermission, loadToolPermissions } from '../src/toolPermissions.js';
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

  const dir = mkdtempSync(join(tmpdir(), 'allowlist-panel-'));
  return { tmpHome: dir, savedHome: redirectHome(dir) };
});

// No SDK, no child process — an off-duty rehire never starts one anyway, but
// hireEmployee (used for the on-duty case) would.
vi.mock('../src/employee.js', () => {
  class ClaudeEmployee {
    sessionId = '';
    start = vi.fn(async () => {});
    setModel = vi.fn(async () => {});
    send = vi.fn();
    stop = vi.fn();
  }
  return { ClaudeEmployee };
});

vi.mock('../src/employeePersistence.js', () => ({
  readEmployees: vi.fn((): SavedEmployee[] => []),
  writeEmployees: vi.fn(),
}));

const SONNET = 'claude-sonnet-5';

function context(): ClientMessageContext {
  return { store: new AgentStateStore(), cache: null };
}

/** The last message the handler sent back. */
function lastSent(send: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return send.mock.calls[send.mock.calls.length - 1][0];
}

interface ListedEmployee {
  agentId: number;
  name: string;
  allow: Array<{ tool: string; match: string; value: string; addedAt: string }>;
}

function listed(ctx: ClientMessageContext): ListedEmployee[] {
  const send = vi.fn();
  handleClientMessage({ type: 'listAllowlist' }, send, ctx);
  return lastSent(send).employees as ListedEmployee[];
}

function permission(tool: string, match: 'exact' | 'dirPrefix', value: string) {
  return { tool, match, value, addedAt: '2026-07-17T14:32:00.000Z' };
}

/** The key this employee's allowlist is filed under, asked of the roster rather
 *  than computed from their name. A permission key is minted at hire and known
 *  only to the roster — deriving one here would seed a bucket the panel cannot
 *  see, and the test would be asserting against its own arithmetic instead of
 *  against the server. Must be called after the employee is on the roster. */
function keyOf(name: string): string {
  return listAllowlistTargets().find((t) => t.name === name)!.key;
}

beforeEach(() => {
  vi.mocked(readEmployees).mockReturnValue([]);
});

afterEach(() => {
  disposeEmployees(); // the staff map is module state — the next test starts empty
  fs.rmSync(`${tmpHome}/.pixel-agents`, { recursive: true, force: true });
  vi.clearAllMocks();
});

afterAll(() => {
  restoreHome(savedHome);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('listAllowlist', () => {
  it('퇴근한(duty: off) 직원도 목록에 나온다 — 사무실을 열면 전원이 이 상태다', async () => {
    // rehireSavedEmployees가 복구 시 전원을 duty:'off'로 넣는다. duty로 거르는
    // 구현이면 이 테스트가 빈 목록을 받는다 = 사무실 켜자마자 패널이 통째로 빈다.
    const ctx = context();
    vi.mocked(readEmployees).mockReturnValue([
      { name: '사이트담당', cwd: '/work', role: 'staff', offDuty: true },
      { name: '기획담당', cwd: '/work', role: 'staff', offDuty: true },
    ]);
    await rehireSavedEmployees(ctx.store, SONNET);

    addPermission(keyOf('사이트담당'), permission('Read', 'dirPrefix', 'F:\\Projects'));

    expect(listed(ctx).map((e) => e.name)).toEqual(['사이트담당', '기획담당']);
  });

  it('허용 항목이 0개인 직원도 이름과 함께, 빈 목록으로 나온다', async () => {
    const ctx = context();
    vi.mocked(readEmployees).mockReturnValue([
      { name: '기획담당', cwd: '/work', role: 'staff', offDuty: true },
    ]);
    await rehireSavedEmployees(ctx.store, SONNET);

    expect(listed(ctx)).toEqual([{ agentId: expect.any(Number), name: '기획담당', allow: [] }]);
  });

  it('저장된 항목을 addedAt까지 그대로 내려준다 — 웹뷰가 추가 시각을 보여준다', async () => {
    const ctx = context();
    vi.mocked(readEmployees).mockReturnValue([
      { name: '사이트담당', cwd: '/work', role: 'staff', offDuty: true },
    ]);
    await rehireSavedEmployees(ctx.store, SONNET);

    addPermission(keyOf('사이트담당'), permission('Bash', 'exact', 'npm run test'));

    expect(listed(ctx)[0].allow).toEqual([
      { tool: 'Bash', match: 'exact', value: 'npm run test', addedAt: '2026-07-17T14:32:00.000Z' },
    ]);
  });

  it('재직 중이 아닌 키(퇴사자)의 잔여 항목은 목록에 없다 — 붙일 이름도 agentId도 없다', async () => {
    const ctx = context();
    vi.mocked(readEmployees).mockReturnValue([
      { name: '사이트담당', cwd: '/work', role: 'staff', offDuty: true },
    ]);
    await rehireSavedEmployees(ctx.store, SONNET);

    // 로스터의 누구도 갖지 않은 키 — 퇴사자가 남기고 간 고아 항목이 이 모양이다.
    // 이름에서 키를 만들지 않는 이상 이런 항목에 붙일 이름은 어디에도 없다.
    addPermission('퇴사자-deadbeef', permission('Read', 'dirPrefix', 'F:\\Old'));

    expect(listed(ctx).map((e) => e.name)).toEqual(['사이트담당']);
  });
});

describe('removeFromAllowlist', () => {
  /** One employee, one standing permission. Returns their agentId. */
  async function withOnePermission(ctx: ClientMessageContext): Promise<number> {
    vi.mocked(readEmployees).mockReturnValue([
      { name: '사이트담당', cwd: '/work', role: 'staff', offDuty: true },
    ]);
    await rehireSavedEmployees(ctx.store, SONNET);
    addPermission(keyOf('사이트담당'), permission('Bash', 'exact', 'npm run test'));
    return listed(ctx)[0].agentId;
  }

  it('agentId를 서버가 키로 풀어서 지운다 — 클라이언트는 키를 보내지 않는다', async () => {
    const ctx = context();
    const agentId = await withOnePermission(ctx);

    handleClientMessage(
      {
        type: 'removeFromAllowlist',
        agentId,
        toolName: 'Bash',
        match: 'exact',
        value: 'npm run test',
      },
      vi.fn(),
      ctx,
    );

    expect(loadToolPermissions().byEmployee[keyOf('사이트담당')].allow).toEqual([]);
  });

  it('삭제 후 갱신된 목록을 즉시 돌려준다 — 웹뷰가 다시 물어보지 않는다', async () => {
    const ctx = context();
    const agentId = await withOnePermission(ctx);
    const send = vi.fn();

    handleClientMessage(
      {
        type: 'removeFromAllowlist',
        agentId,
        toolName: 'Bash',
        match: 'exact',
        value: 'npm run test',
      },
      send,
      ctx,
    );

    expect(lastSent(send)).toEqual({
      type: 'allowlistListed',
      employees: [{ agentId, name: '사이트담당', allow: [] }],
    });
  });

  it('명부에 없는 agentId는 아무것도 지우지 않는다 — 엉뚱한 키가 만들어지지도 않는다', async () => {
    const ctx = context();
    const agentId = await withOnePermission(ctx);
    const before = loadToolPermissions();

    handleClientMessage(
      {
        type: 'removeFromAllowlist',
        agentId: agentId + 999,
        toolName: 'Bash',
        match: 'exact',
        value: 'npm run test',
      },
      vi.fn(),
      ctx,
    );

    expect(loadToolPermissions()).toEqual(before);
  });

  // 키를 그대로 믿으면, 포트에 닿을 수 있는 누구나 아무 직원의 허용목록을 지운다.
  // 이 서버는 0.0.0.0에 바인드될 수 있고 /ws는 토큰 없는 연결도 받는다.
  it('클라이언트가 보낸 employeeKey는 무시한다', async () => {
    const ctx = context();
    await withOnePermission(ctx);

    handleClientMessage(
      {
        type: 'removeFromAllowlist',
        employeeKey: keyOf('사이트담당'),
        toolName: 'Bash',
        match: 'exact',
        value: 'npm run test',
      },
      vi.fn(),
      ctx,
    );

    expect(loadToolPermissions().byEmployee[keyOf('사이트담당')].allow).toHaveLength(1);
  });

  it('값이 다르면 지우지 않는다 — 도구·match·value 셋이 한 항목을 지목한다', async () => {
    const ctx = context();
    const agentId = await withOnePermission(ctx);

    handleClientMessage(
      {
        type: 'removeFromAllowlist',
        agentId,
        toolName: 'Bash',
        match: 'exact',
        value: 'npm run build',
      },
      vi.fn(),
      ctx,
    );

    expect(loadToolPermissions().byEmployee[keyOf('사이트담당')].allow).toHaveLength(1);
  });
});
