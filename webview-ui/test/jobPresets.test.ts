import assert from 'node:assert/strict';

import { test } from 'vitest';

import { applyJobPreset, JOB_PRESETS } from '../src/jobPresets.js';

test('applyJobPreset: 알려진 직무 id는 직함·지침·모델을 채운다', () => {
  const fields = applyJobPreset('developer');

  assert.ok(fields);
  assert.equal(fields.roleLabel, '개발자');
  assert.equal(fields.model, 'claude-opus-4-8');
  assert.ok(fields.persona.length > 0);
});

test('applyJobPreset: 빈 id("직무 선택 안 함")는 undefined를 반환한다', () => {
  assert.equal(applyJobPreset(''), undefined);
});

test('applyJobPreset: 알 수 없는 id도 undefined를 반환한다', () => {
  assert.equal(applyJobPreset('no-such-job'), undefined);
});

test('JOB_PRESETS: 다섯 개 직무가 모두 고유한 id를 가진다', () => {
  assert.equal(JOB_PRESETS.length, 5);
  assert.equal(new Set(JOB_PRESETS.map((p) => p.id)).size, 5);
});
