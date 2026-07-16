import { describe, expect, it } from 'vitest';

import { buildClaudeSpawn } from '../src/claudeCli.js';

describe('buildClaudeSpawn', () => {
  const REAL_ARGS = ['-p', '--no-session-persistence', '/usage'];

  it('POSIX: no shell, argv passed straight through (zero injection surface)', () => {
    const spec = buildClaudeSpawn(REAL_ARGS, 'linux');
    expect(spec.shell).toBe(false);
    expect(spec.command).toBe('claude');
    expect(spec.args).toEqual(REAL_ARGS);
  });

  it('Windows: single command string + shell, NO args array (avoids the DEP0190 combo)', () => {
    const spec = buildClaudeSpawn(REAL_ARGS, 'win32');
    expect(spec.shell).toBe(true);
    expect(spec.args).toBeUndefined(); // never args-array + shell:true together
  });

  it('Windows: literal flags are byte-identical to the old unescaped join (no regression)', () => {
    // None of the real args have shell-significant chars, so they must NOT gain
    // quotes — the command string must equal what spawn(cmd, args, {shell:true})
    // used to build internally.
    const spec = buildClaudeSpawn(REAL_ARGS, 'win32');
    expect(spec.command).toBe('claude -p --no-session-persistence /usage');
    expect(buildClaudeSpawn(['--version'], 'win32').command).toBe('claude --version');
  });

  it('Windows: args with spaces or metacharacters get quoted (defense in depth)', () => {
    expect(buildClaudeSpawn(['a b'], 'win32').command).toBe('claude "a b"');
    expect(buildClaudeSpawn(['x & y'], 'win32').command).toBe('claude "x & y"');
    expect(buildClaudeSpawn(['a"b'], 'win32').command).toBe('claude "a""b"');
    expect(buildClaudeSpawn([''], 'win32').command).toBe('claude ""');
  });
});
