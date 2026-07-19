/**
 * Unit tests for the pure board-window helpers (boardEntries.ts).
 *
 * The window itself (BoardWindow.tsx) is deliberately not covered here — this
 * project's webview tests run in a Node environment with no DOM, so component
 * rendering isn't testable this way (same reason folderPicker.test.ts stops at
 * the navigation logic). What matters for correctness is the parsing of what
 * the server actually writes, and picking which team's board to show.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { TeamMember } from '../src/components/boardEntries.js';
import {
  parseBoard,
  parseBoardEntry,
  resolveTeamRoot,
  splitBoard,
  teamOptions,
} from '../src/components/boardEntries.js';

const TWO_LAYER = `# BOARD — 팀 회의록 (블랙보드)

> 안내 문구

## 현재 계획

## 목표
로그인 기능

## 제약
- 외부 CDN 금지

## 기록

- \`10시 0분 0초\` **[배분]** 팀장 → 개발자: 시작해라
`;

test('splitBoard: 계획과 기록을 갈라낸다', () => {
  const { plan, log } = splitBoard(TWO_LAYER);
  assert.ok(plan.includes('## 목표'));
  assert.ok(plan.includes('## 제약'));
  assert.ok(!plan.includes('[배분]'));
  assert.ok(log.includes('[배분]'));
  assert.ok(!log.includes('## 목표'));
});

test('splitBoard: 계획 안의 소제목이 살아남는다 — parseBoard에 통째로 넘기면 사라진다', () => {
  // parseBoardEntry는 '#'으로 시작하는 줄을 파일 머리말로 보고 버린다. 계획을
  // 먼저 떼어내지 않으면 팀장이 세운 목표·제약·역할 구조가 화면에서 증발한다.
  const swallowed = parseBoard(TWO_LAYER).map((e) => e.text);
  assert.ok(!swallowed.some((t) => t.includes('목표')));

  const { plan } = splitBoard(TWO_LAYER);
  assert.ok(plan.includes('목표'));
});

test('splitBoard: 두 층 이전 보드는 전부 기록으로 본다', () => {
  const old = '# BOARD\n\n> 안내\n\n- `10시 0분 0초` **[배분]** 팀장 → 개발자: 시작\n';
  const { plan, log } = splitBoard(old);
  assert.equal(plan, '');
  assert.equal(log, old);
  assert.equal(parseBoard(log).length, 1);
});

/** A line in exactly the shape appendBoard (server/src/employees.ts) writes. */
const REAL_LINE =
  '- `12시 20분 33초` **[배분]** 팀장 → 디자인 / 디자이너: design-spec.md를 작성하라';

function employee(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    agentId: 1,
    name: '팀장',
    cwd: 'F:\\Projects\\a',
    role: 'lead',
    ...overrides,
  };
}

// --- parseBoardEntry -------------------------------------------------------

test('parses the line format the server writes', () => {
  const entry = parseBoardEntry(REAL_LINE);
  assert.deepEqual(entry, {
    time: '12시 20분 33초',
    kind: '배분',
    text: '팀장 → 디자인 / 디자이너: design-spec.md를 작성하라',
  });
});

test('parses 수거 as well as 배분', () => {
  const entry = parseBoardEntry('- `13시 1분 2초` **[수거]** 개발 → 팀장: 완료');
  assert.equal(entry?.kind, '수거');
  assert.equal(entry?.text, '개발 → 팀장: 완료');
});

test('keeps an unknown kind rather than dropping the entry', () => {
  // The server owns the kind vocabulary and may add to it; an entry with a
  // kind this client has never heard of must still reach the reader.
  const entry = parseBoardEntry('- `9시 0분 0초` **[승인]** 팀장: 반영');
  assert.equal(entry?.kind, '승인');
  assert.equal(entry?.text, '팀장: 반영');
});

test('drops the file header and blurb, which are boilerplate', () => {
  assert.equal(parseBoardEntry('# BOARD — 팀 회의록 (블랙보드)'), null);
  assert.equal(parseBoardEntry('> 팀장이 배분하고 팀원 결과가 수거될 때마다 기록된다.'), null);
  assert.equal(parseBoardEntry(''), null);
  assert.equal(parseBoardEntry('   '), null);
});

test('shows an unrecognized non-boilerplate line instead of hiding it', () => {
  // It is in the user's file, and showing the file is this view's whole job.
  const entry = parseBoardEntry('손으로 적어 넣은 메모');
  assert.deepEqual(entry, { time: '', kind: '', text: '손으로 적어 넣은 메모' });
});

test('an entry whose text contains brackets and backticks survives', () => {
  const entry = parseBoardEntry('- `1시 2분 3초` **[배분]** 팀장: `src/a.ts` 의 [주의] 부분');
  assert.equal(entry?.kind, '배분');
  assert.equal(entry?.text, '팀장: `src/a.ts` 의 [주의] 부분');
});

// --- parseBoard ------------------------------------------------------------

test('parses a whole file, oldest first, header excluded', () => {
  const file = [
    '# BOARD — 팀 회의록 (블랙보드)',
    '',
    '> 자동 기록된다.',
    '',
    '- `1시 0분 0초` **[배분]** 첫째',
    '- `2시 0분 0초` **[수거]** 둘째',
    '',
  ].join('\n');

  const entries = parseBoard(file);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, '첫째');
  assert.equal(entries[1].text, '둘째');
});

test('an empty file yields no entries rather than throwing', () => {
  assert.deepEqual(parseBoard(''), []);
});

test('a stray non-boilerplate line is still shown rather than hidden', () => {
  const entries = parseBoard('머리말 아닌 한 줄\n- `1시 0분 0초` **[배분]** 첫째');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, '');
  assert.equal(entries[0].text, '머리말 아닌 한 줄');
});

// --- teamOptions -----------------------------------------------------------

test('offers one option per lead with a cwd', () => {
  const teams = teamOptions([
    employee({ agentId: 1, name: '팀장A', cwd: 'F:\\a' }),
    employee({ agentId: 2, name: '팀원', cwd: 'F:\\b', role: 'staff' }),
    employee({ agentId: 3, name: '팀장B', cwd: 'F:\\c' }),
  ]);
  assert.deepEqual(
    teams.map((t) => t.name),
    ['팀장A', '팀장B'],
  );
  assert.deepEqual(
    teams.map((t) => t.root),
    ['F:\\a', 'F:\\c'],
  );
});

test('two leads sharing a folder share one board, so one option', () => {
  const teams = teamOptions([
    employee({ agentId: 1, name: '팀장A', cwd: 'F:\\same' }),
    employee({ agentId: 2, name: '팀장B', cwd: 'F:\\same' }),
  ]);
  assert.equal(teams.length, 1);
});

test('a lead without a cwd is not a team', () => {
  assert.deepEqual(teamOptions([employee({ cwd: '' })]), []);
});

test('no employees at all means no teams', () => {
  assert.deepEqual(teamOptions([]), []);
});

// --- resolveTeamRoot -------------------------------------------------------

test('honours the pick when that team still exists', () => {
  const teams = teamOptions([
    employee({ agentId: 1, name: 'A', cwd: 'F:\\a' }),
    employee({ agentId: 2, name: 'B', cwd: 'F:\\b' }),
  ]);
  assert.equal(resolveTeamRoot(teams, 'F:\\b'), 'F:\\b');
});

test('falls back to the first team when the pick went away', () => {
  // The lead can be fired while the window sits open; without this the window
  // would be stuck showing an empty state the user cannot get out of.
  const teams = teamOptions([employee({ agentId: 1, name: 'A', cwd: 'F:\\a' })]);
  assert.equal(resolveTeamRoot(teams, 'F:\\gone'), 'F:\\a');
});

test('defaults to the first team when nothing is picked', () => {
  const teams = teamOptions([
    employee({ agentId: 1, name: 'A', cwd: 'F:\\a' }),
    employee({ agentId: 2, name: 'B', cwd: 'F:\\b' }),
  ]);
  assert.equal(resolveTeamRoot(teams, undefined), 'F:\\a');
});

test('no teams resolves to undefined, the honest empty state', () => {
  assert.equal(resolveTeamRoot([], undefined), undefined);
  assert.equal(resolveTeamRoot([], 'F:\\a'), undefined);
});
