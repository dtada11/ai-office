import assert from 'node:assert/strict';

import { test } from 'vitest';

import { TEAM_TEMPLATES } from '../../core/src/teamTemplates.js';
import { buildScaffoldPreview } from '../src/teamScaffoldPreview.js';

const pureDev = TEAM_TEMPLATES.find((t) => t.key === 'pure-dev')!;
const productTeam = TEAM_TEMPLATES.find((t) => t.key === 'product-team')!;

test('buildScaffoldPreview: returns null when baseDir is blank', () => {
  assert.equal(buildScaffoldPreview(pureDev, '', 'my-app'), null);
});

test('buildScaffoldPreview: returns null when projectName is blank', () => {
  assert.equal(buildScaffoldPreview(pureDev, 'C:\\Users\\me\\projects', '   '), null);
});

test('buildScaffoldPreview: builds a Windows-style tree for a Windows baseDir', () => {
  const preview = buildScaffoldPreview(pureDev, 'C:\\Users\\me\\projects', 'my-app');
  assert.ok(preview);
  assert.equal(preview.projectDir, 'C:\\Users\\me\\projects\\my-app');
  assert.deepEqual(preview.dirs.sort(), [
    'C:\\Users\\me\\projects\\my-app',
    'C:\\Users\\me\\projects\\my-app\\src',
    'C:\\Users\\me\\projects\\my-app\\tests',
  ]);
});

test('buildScaffoldPreview: trims a trailing separator on baseDir', () => {
  const withSlash = buildScaffoldPreview(pureDev, 'C:\\Users\\me\\projects\\', 'my-app');
  const withoutSlash = buildScaffoldPreview(pureDev, 'C:\\Users\\me\\projects', 'my-app');
  assert.deepEqual(withSlash, withoutSlash);
});

test('buildScaffoldPreview: builds a POSIX-style tree for a POSIX baseDir', () => {
  const preview = buildScaffoldPreview(pureDev, '/home/me/projects', 'my-app');
  assert.ok(preview);
  assert.equal(preview.projectDir, '/home/me/projects/my-app');
  assert.deepEqual(preview.dirs.sort(), [
    '/home/me/projects/my-app',
    '/home/me/projects/my-app/src',
    '/home/me/projects/my-app/tests',
  ]);
});

test('buildScaffoldPreview: the lead role points at the project root, not a subfolder', () => {
  const preview = buildScaffoldPreview(pureDev, '/base', 'app')!;
  const lead = preview.roster.find((r) => r.org === 'lead');
  assert.ok(lead);
  assert.equal(lead.cwd, '/base/app');
  assert.equal(lead.roleLabel, '팀장');
});

test('buildScaffoldPreview: role labels resolve through the job preset, not the raw defaultRoleLabel', () => {
  // product-team's 'src' role has defaultRoleLabel '개발' (short form) but
  // presetKey 'developer', whose preset label is '개발자' -- if the preview
  // ever stopped resolving through applyJobPreset and fell back to
  // defaultRoleLabel, this is the test that would catch it.
  const preview = buildScaffoldPreview(productTeam, '/base', 'app')!;
  const developer = preview.roster.find((r) => r.cwd === '/base/app/src');
  assert.ok(developer);
  assert.equal(developer.roleLabel, '개발자');
});

test('buildScaffoldPreview: product-team template resolves all four roles', () => {
  const preview = buildScaffoldPreview(productTeam, '/base', 'app')!;
  assert.equal(preview.roster.length, 4);
  // '개발자' (not the template's raw defaultRoleLabel '개발') because the
  // 'src' role's presetKey resolves through applyJobPreset -- see the
  // dedicated test above for why.
  assert.deepEqual(
    preview.roster.map((r) => r.roleLabel).sort(),
    ['개발자', '기획자', '마케터', '팀장'].sort(),
  );
});
