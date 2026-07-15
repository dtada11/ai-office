import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { SetupCheck } from '../src/setupCheckCopy.js';
import { setupCheckCopy } from '../src/setupCheckCopy.js';

function check(id: SetupCheck['id'], status: SetupCheck['status'], detail?: string): SetupCheck {
  return detail !== undefined ? { id, status, detail } : { id, status };
}

test('claudeInstalled: ok는 안내 문구가 없다', () => {
  const copy = setupCheckCopy(check('claudeInstalled', 'ok'));
  assert.equal(copy.label, 'Claude Code 설치');
  assert.equal(copy.message, undefined);
  assert.equal(copy.docsUrl, undefined);
});

test('claudeInstalled: fail은 설치 안내와 문서 링크를 함께 준다', () => {
  const copy = setupCheckCopy(check('claudeInstalled', 'fail'));
  assert.ok(copy.message?.includes('claude-code'));
  assert.ok(copy.docsUrl);
});

test('claudeLoggedIn: skip은 라벨만 있고 안내 문구가 없다', () => {
  const copy = setupCheckCopy(check('claudeLoggedIn', 'skip'));
  assert.equal(copy.label, 'Claude Code 로그인');
  assert.equal(copy.message, undefined);
});

test('claudeLoggedIn: fail은 로그인 방법을 안내한다', () => {
  const copy = setupCheckCopy(check('claudeLoggedIn', 'fail'));
  assert.ok(copy.message?.includes('claude'));
});

test('apiKeyFormat: fail은 sk-ant- 접두사를 언급한다', () => {
  const copy = setupCheckCopy(check('apiKeyFormat', 'fail'));
  assert.ok(copy.message?.includes('sk-ant-'));
});

test('apiKeyFormat: ok는 안내 문구가 없다', () => {
  const copy = setupCheckCopy(check('apiKeyFormat', 'ok'));
  assert.equal(copy.message, undefined);
});

test('apiKeyValid: fail은 401과 재발급 방법을 안내한다', () => {
  const copy = setupCheckCopy(check('apiKeyValid', 'fail', 'HTTP 401'));
  assert.ok(copy.message?.includes('401'));
  assert.ok(copy.message?.includes('console.anthropic.com'));
});

test('apiKeyValid: ok는 크레딧 경고 문구를 준다', () => {
  const copy = setupCheckCopy(check('apiKeyValid', 'ok'));
  assert.ok(copy.message?.includes('크레딧'));
});

test('apiKeyValid: skip은 안내 문구가 없다', () => {
  const copy = setupCheckCopy(check('apiKeyValid', 'skip'));
  assert.equal(copy.message, undefined);
});

test('모든 id는 고유한 라벨을 가진다', () => {
  const ids: SetupCheck['id'][] = [
    'claudeInstalled',
    'claudeLoggedIn',
    'apiKeyFormat',
    'apiKeyValid',
  ];
  const labels = ids.map((id) => setupCheckCopy(check(id, 'ok')).label);
  assert.equal(new Set(labels).size, ids.length);
});
