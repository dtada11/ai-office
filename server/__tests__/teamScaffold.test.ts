import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.spyOn(fs, 'mkdirSync')` doesn't work here -- Vitest/Node's ESM `fs`
// namespace isn't configurable, so spying throws "Cannot redefine property".
// vi.mock replaces the whole module instead, which does work under ESM.
// Gated behind `failOnCall` (armed only by the rollback test below) so every
// other test in this file still goes through the real fs untouched.
const mkdirState = vi.hoisted(() => ({ callCount: 0, failOnCall: null as number | null }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => {
      mkdirState.callCount += 1;
      if (mkdirState.callCount === mkdirState.failOnCall) {
        throw new Error('simulated mkdir failure');
      }
      return actual.mkdirSync(...args);
    },
  };
});

const fs = await import('fs');
const { scaffoldTeamProject } = await import('../src/teamScaffold.js');

describe('scaffoldTeamProject', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-scaffold-test-'));
    mkdirState.callCount = 0;
    mkdirState.failOnCall = null;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 1. Normal creation: the project root plus every role's subfolder exist,
  // and the roster names match the template's roles.
  it('creates the project root and every role subfolder, and returns an accurate roster', () => {
    const result = scaffoldTeamProject('pure-dev', tmpRoot, 'my-app');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const projectDir = path.join(tmpRoot, 'my-app');
    expect(result.projectDir).toBe(projectDir);
    expect(fs.statSync(projectDir).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(projectDir, 'src')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(projectDir, 'tests')).isDirectory()).toBe(true);

    expect(result.roster.map((r) => r.roleLabel).sort()).toEqual(
      ['개발자', '테스터', '팀장'].sort(),
    );
    const lead = result.roster.find((r) => r.org === 'lead');
    expect(lead?.cwd).toBe(projectDir);
    const developer = result.roster.find((r) => r.roleLabel === '개발자');
    expect(developer?.cwd).toBe(path.join(projectDir, 'src'));
    expect(developer?.model).toBe('claude-opus-4-8');
    expect(developer?.persona.length).toBeGreaterThan(0);
  });

  // 2. product-team template: four roles, four folders (root + 3 subfolders).
  it('creates all four roles of the product-team template', () => {
    const result = scaffoldTeamProject('product-team', tmpRoot, 'my-product');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const projectDir = path.join(tmpRoot, 'my-product');
    expect(fs.statSync(path.join(projectDir, 'docs')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(projectDir, 'src')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(projectDir, 'marketing')).isDirectory()).toBe(true);
    expect(result.roster).toHaveLength(4);
    // '개발자' (not the template's raw defaultRoleLabel '개발') because the
    // 'src' role's presetKey resolves through applyJobPreset.
    expect(result.roster.map((r) => r.roleLabel).sort()).toEqual(
      ['개발자', '기획자', '마케터', '팀장'].sort(),
    );
  });

  // 3. Create-only: an existing top-level project folder is refused, and
  // nothing at all is created or modified -- verified by snapshotting the
  // base directory's contents before and after the rejected call.
  it('refuses an existing top-level path and creates nothing', () => {
    const existing = path.join(tmpRoot, 'already-here');
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, 'keep-me.txt'), 'do not touch');

    const before = fs.readdirSync(tmpRoot).sort();
    const beforeInner = fs.readdirSync(existing).sort();

    const result = scaffoldTeamProject('pure-dev', tmpRoot, 'already-here');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('이미 존재');

    // Nothing in the base dir changed, and the existing folder's own
    // contents (the file the "app" must never touch) are untouched.
    expect(fs.readdirSync(tmpRoot).sort()).toEqual(before);
    expect(fs.readdirSync(existing).sort()).toEqual(beforeInner);
    expect(fs.readFileSync(path.join(existing, 'keep-me.txt'), 'utf8')).toBe('do not touch');
  });

  // 4. Rollback: if a subfolder fails to create partway through, the whole
  // (brand-new) project folder is removed again -- verified by forcing the
  // second mkdirSync call (the project root succeeds first, then the first
  // role subfolder is forced to fail) and asserting the project dir ends up
  // gone entirely, not left half-built.
  it('rolls back the whole project folder if a subfolder fails to create', () => {
    mkdirState.failOnCall = 2;

    const projectDir = path.join(tmpRoot, 'my-app');
    const result = scaffoldTeamProject('pure-dev', tmpRoot, 'my-app');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('되돌렸습니다');
    expect(fs.existsSync(projectDir)).toBe(false);
    // The base dir itself (which pre-existed) is untouched otherwise.
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  // 5. Unknown template key is a safe, clear error -- nothing created.
  it('rejects an unknown template key without creating anything', () => {
    const result = scaffoldTeamProject('no-such-template', tmpRoot, 'my-app');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('알 수 없는 템플릿');
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  // 6. Project names cannot escape baseDir via a path separator or '..'.
  it.each(['..', '.', 'a/b', 'a\\b', '', '   '])(
    'rejects an invalid project name: %j',
    (badName) => {
      const result = scaffoldTeamProject('pure-dev', tmpRoot, badName);
      expect(result.ok).toBe(false);
      expect(fs.readdirSync(tmpRoot)).toEqual([]);
    },
  );

  // 7. A baseDir that doesn't exist is a safe error, not a throw.
  it('rejects a baseDir that does not exist', () => {
    const missingBase = path.join(tmpRoot, 'does-not-exist');
    expect(() => scaffoldTeamProject('pure-dev', missingBase, 'my-app')).not.toThrow();
    const result = scaffoldTeamProject('pure-dev', missingBase, 'my-app');
    expect(result.ok).toBe(false);
  });
});
