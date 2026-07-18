/**
 * Unit tests for the pure dashboard-tab helpers (dashboard/dashboardModel.ts).
 *
 * Same boundary as boardEntries.test.ts: the webview tests run in a plain Node
 * environment with no DOM, so the tab, the panels and the canvas are not
 * rendered here. What is decidable — and what actually carries the risk when
 * porting a standalone dashboard into the office — is the mapping from
 * broadcast messages to feed rows and flow packets, and the derivation of the
 * 직원 rows from state the webview already holds.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type {
  AgentRowsInput,
  DashboardEmployee,
} from '../src/components/dashboard/dashboardModel.js';
import {
  buildAgentRows,
  FEED_CAP,
  feedRowFor,
  flowPacketFor,
  flowStaff,
  hhmmss,
  layoutFlowNodes,
  pushCapped,
  short,
  STUCK_SECONDS,
} from '../src/components/dashboard/dashboardModel.js';

const AT = 1_700_000_000_000;
const label = (id: number | undefined) => (id === undefined ? 'office' : `직원${id}`);

// ── 피드 ────────────────────────────────────────────────────────────────────

test('feedRowFor: 도구 시작은 도구 이름과 함께 tool 행이 된다', () => {
  const row = feedRowFor({ type: 'agentToolStart', id: 3, toolName: 'Read' }, label, AT);
  assert.ok(row);
  assert.equal(row.cls, 'tool');
  assert.equal(row.tag, 'TOOL▶');
  assert.equal(row.who, '직원3');
  assert.equal(row.text, 'Read');
  assert.equal(row.at, AT);
});

test('feedRowFor: 결재 중·백그라운드 표식이 도구 행에 붙는다', () => {
  const row = feedRowFor(
    {
      type: 'agentToolStart',
      id: 1,
      toolName: 'Bash',
      permissionActive: true,
      runInBackground: true,
    },
    label,
    AT,
  );
  assert.equal(row?.text, 'Bash · 결재중 · bg');
});

test('feedRowFor: 빈 스트리밍 조각은 행이 되지 않는다', () => {
  assert.equal(
    feedRowFor({ type: 'agentEvent', agentId: 1, kind: 'text', text: '   ' }, label, AT),
    null,
  );
  assert.ok(feedRowFor({ type: 'agentEvent', agentId: 1, kind: 'text', text: '안녕' }, label, AT));
});

test('feedRowFor: 관심 없는 메시지(에셋·스프라이트·레이아웃)는 무시된다', () => {
  for (const type of ['layoutLoaded', 'furnitureAssetsLoaded', 'settingsLoaded', 'employeeState']) {
    assert.equal(feedRowFor({ type }, label, AT), null, type);
  }
});

test('feedRowFor: 회의록 갱신은 회의록 태그가 붙은 board 행이 된다', () => {
  const row = feedRowFor(
    { type: 'boardUpdate', kind: '배분', text: '팀장 → 개발자: 탭 작업' },
    label,
    AT,
  );
  assert.equal(row?.cls, 'board');
  assert.equal(row?.who, 'BOARD.md');
  assert.equal(row?.text, '[배분] 팀장 → 개발자: 탭 작업');
});

test('feedRowFor: 셸 종료 코드가 0이 아니면 에러 행', () => {
  assert.equal(feedRowFor({ type: 'shellExit', exitCode: 1 }, label, AT)?.cls, 'err');
  assert.equal(feedRowFor({ type: 'shellExit', exitCode: 0 }, label, AT)?.cls, 'done');
});

test('short: 공백을 접고 길이를 자른다', () => {
  assert.equal(short('  가  나\n다  '), '가 나 다');
  assert.equal(short('abcdef', 3), 'abc…');
});

test('hhmmss: 자리수가 고정된 HH:MM:SS (한국어 로케일 표기는 줄바꿈을 만든다)', () => {
  const d = new Date(2026, 6, 19, 5, 4, 3);
  assert.equal(hhmmss(d.getTime()), '05:04:03');
});

test('pushCapped: 상한을 넘으면 오래된 것부터 버린다', () => {
  let rows: number[] = [];
  for (let i = 0; i < 5; i++) rows = pushCapped(rows, i, 3);
  assert.deepEqual(rows, [2, 3, 4]);
  assert.equal(FEED_CAP, 300);
});

// ── 팀 흐름 ─────────────────────────────────────────────────────────────────

test('flowPacketFor: 팀장 지시는 팀장 → 팀원(배분)', () => {
  const p = flowPacketFor(
    { type: 'agentEvent', agentId: 7, kind: 'system', text: '팀장 지시: 시작' },
    AT,
  );
  assert.deepEqual(p, { from: 'LEAD', to: 7, kind: 'out', born: AT });
});

test('flowPacketFor: 결과는 팀원 → 팀장(수거)', () => {
  const p = flowPacketFor({ type: 'agentEvent', agentId: 7, kind: 'result', text: '완료' }, AT);
  assert.deepEqual(p, { from: 7, to: 'LEAD', kind: 'back', born: AT });
});

test('flowPacketFor: 그 외 이벤트는 패킷을 만들지 않는다', () => {
  assert.equal(
    flowPacketFor({ type: 'agentEvent', agentId: 7, kind: 'text', text: '팀장 지시' }, AT),
    null,
  );
  assert.equal(flowPacketFor({ type: 'agentToolStart', id: 7 }, AT), null);
  assert.equal(flowPacketFor({ type: 'agentEvent', kind: 'result' }, AT), null);
});

test('layoutFlowNodes: 팀장은 중앙, 팀원은 그 주위에', () => {
  const nodes = layoutFlowNodes(
    [
      { agentId: 1, name: '개발자', active: true, perm: false },
      { agentId: 2, name: '검증자', active: false, perm: true },
    ],
    400,
    300,
  );
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].id, 'LEAD');
  assert.deepEqual([nodes[0].x, nodes[0].y], [200, 150]);
  // 첫 팀원은 12시 방향
  assert.ok(Math.abs(nodes[1].x - 200) < 0.001);
  assert.ok(nodes[1].y < 150);
  assert.equal(nodes[1].active, true);
  assert.equal(nodes[2].perm, true);
});

test('layoutFlowNodes: 긴 이름은 노드 라벨에서 잘린다', () => {
  const nodes = layoutFlowNodes(
    [{ agentId: 1, name: '아주아주아주긴이름', active: false, perm: false }],
    200,
    200,
  );
  assert.equal(nodes[1].label.length, 7);
});

// ── 직원 패널 ───────────────────────────────────────────────────────────────

const employee = (over: Partial<DashboardEmployee> & { agentId: number }): DashboardEmployee => ({
  name: `이름${over.agentId}`,
  role: 'staff',
  duty: 'on',
  cwd: 'F:/work',
  ...over,
});

const rowsInput = (over: Partial<AgentRowsInput>): AgentRowsInput => ({
  employees: [],
  tools: {},
  permissionCounts: {},
  busy: {},
  statuses: {},
  tokens: {},
  counters: {},
  toolStartedAt: {},
  now: AT,
  toolNameOf: (s) => s.split(' ')[0],
  ...over,
});

test('buildAgentRows: 퇴근한 직원은 빠지고 팀장이 먼저 온다', () => {
  const rows = buildAgentRows(
    rowsInput({
      employees: [
        employee({ agentId: 2 }),
        employee({ agentId: 9, duty: 'off' }),
        employee({ agentId: 5, role: 'lead' }),
      ],
    }),
  );
  assert.deepEqual(
    rows.map((r) => r.agentId),
    [5, 2],
  );
  assert.equal(rows[0].roleText, '팀장');
  assert.equal(rows[1].roleText, '팀원');
});

test('buildAgentRows: 상태 우선순위는 결재 > 작업 중 > 대기 > 없음', () => {
  const base = { employees: [employee({ agentId: 1 })] };
  assert.equal(buildAgentRows(rowsInput(base)).at(0)?.statusKind, 'idle');
  assert.equal(
    buildAgentRows(rowsInput({ ...base, statuses: { 1: 'waiting' } })).at(0)?.statusKind,
    'waiting',
  );
  assert.equal(
    buildAgentRows(rowsInput({ ...base, statuses: { 1: 'waiting' }, busy: { 1: true } })).at(0)
      ?.statusKind,
    'active',
  );
  assert.equal(
    buildAgentRows(rowsInput({ ...base, busy: { 1: true }, permissionCounts: { 1: 2 } })).at(0)
      ?.statusKind,
    'perm',
  );
});

test('buildAgentRows: 끝나지 않은 도구만 세고, 오래 열려 있으면 막힘으로 표시한다', () => {
  const rows = buildAgentRows(
    rowsInput({
      employees: [employee({ agentId: 1 })],
      tools: {
        1: [
          { toolId: 'a', status: 'Read: x', done: true },
          { toolId: 'b', status: 'Bash: npm test', done: false },
          { toolId: 'c', status: 'Edit: y', done: false },
        ],
      },
      toolStartedAt: { b: AT - STUCK_SECONDS * 1000, c: AT - 3000 },
      counters: { 1: { started: 3, done: 1 } },
    }),
  );
  const row = rows[0];
  assert.equal(row.open, 2);
  assert.equal(row.started, 3);
  assert.equal(row.done, 1);
  assert.deepEqual(
    row.tools.map((t) => [t.name, t.seconds, t.stuck]),
    [
      ['Bash:', STUCK_SECONDS, true],
      ['Edit:', 3, false],
    ],
  );
});

test('buildAgentRows: 토큰 사용량이 로스터 값보다 최신으로 취급된다', () => {
  const rows = buildAgentRows(
    rowsInput({
      employees: [
        employee({ agentId: 1, model: '로스터모델', contextTokens: 1000, contextLimit: 200000 }),
      ],
      tokens: { 1: { model: '최신모델', contextTokens: 50_000, contextLimit: 200_000 } },
    }),
  );
  assert.equal(rows[0].model, '최신모델');
  assert.equal(rows[0].context, '50k / 200k');
});

test('buildAgentRows: 비용은 apiKey 모드에서만 오는 값이라 없으면 —', () => {
  const rows = buildAgentRows(rowsInput({ employees: [employee({ agentId: 1 })] }));
  assert.equal(rows[0].cost, '—');
  assert.equal(rows[0].context, '—');
});

test('flowStaff: 팀장은 링에 그리지 않는다', () => {
  const rows = buildAgentRows(
    rowsInput({
      employees: [employee({ agentId: 1, role: 'lead' }), employee({ agentId: 2 })],
      busy: { 2: true },
    }),
  );
  const staff = flowStaff(rows);
  assert.deepEqual(
    staff.map((s) => s.agentId),
    [2],
  );
  assert.equal(staff[0].active, true);
});
