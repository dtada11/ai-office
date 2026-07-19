import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readJson, writeJsonAtomic } from '../src/jsonFile.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-jsonfile-'));
  // These paths are all error branches; the warnings are the point, not noise
  // worth printing during a test run.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('readJson', () => {
  it('reads back what was written', () => {
    const file = path.join(dir, 'a.json');
    writeJsonAtomic(file, { hello: 'world', n: 1 });

    expect(readJson(file, 'test')).toEqual({ hello: 'world', n: 1 });
  });

  it('returns null for a file that is not there', () => {
    expect(readJson(path.join(dir, 'missing.json'), 'test')).toBeNull();
  });

  it('returns null for a corrupt file instead of throwing', () => {
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, '{ "half-written": ');

    // Callers fall back to their own defaults on null; a throw here would take
    // down whatever was starting up.
    expect(readJson(file, 'test')).toBeNull();
  });
});

describe('writeJsonAtomic', () => {
  it('reports success so a caller can tell the user their save landed', () => {
    expect(writeJsonAtomic(path.join(dir, 'ok.json'), { a: 1 })).toBe(true);
  });

  it('reports failure instead of throwing', () => {
    // Parent of the target is an existing *file*, so the directory can't be made.
    const blocker = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');

    // The layout save shows "couldn't save" off this false. Swallowing it would
    // let the user believe a layout was kept and find it rolled back on restart.
    expect(writeJsonAtomic(path.join(blocker, 'nested.json'), { a: 1 })).toBe(false);
  });

  it('creates the directory when it does not exist yet', () => {
    const file = path.join(dir, 'deep', 'nested', 'x.json');

    expect(writeJsonAtomic(file, { a: 1 })).toBe(true);
    expect(readJson(file, 'test')).toEqual({ a: 1 });
  });

  it('leaves the old file intact when the write fails', () => {
    const file = path.join(dir, 'keep.json');
    writeJsonAtomic(file, { good: true });

    // A value JSON.stringify refuses (BigInt) fails after the target already exists.
    expect(writeJsonAtomic(file, { bad: 1n })).toBe(false);
    expect(readJson(file, 'test')).toEqual({ good: true });
  });

  it('survives a temp file left behind by an earlier crashed write', () => {
    const file = path.join(dir, 'roster.json');
    fs.writeFileSync(file + '.tmp', 'garbage from a run that died mid-write');

    expect(writeJsonAtomic(file, { employees: ['코더'] })).toBe(true);
    expect(readJson(file, 'test')).toEqual({ employees: ['코더'] });
  });

  it('cleans up its temp file', () => {
    const file = path.join(dir, 'clean.json');
    writeJsonAtomic(file, { a: 1 });

    expect(fs.existsSync(file + '.tmp')).toBe(false);
  });

  it('removes the temp rather than writing over it', () => {
    // This is what protects the roster's keys, and unlike the permission-bit
    // checks below it holds on every platform. fs.writeFileSync applies `mode`
    // only when it CREATES the file, so the remove has to come first —
    // otherwise a temp left by a crashed run hands its own, wider permissions
    // to the roster. A read-only temp proves the order: writing over it fails,
    // removing it first succeeds.
    const file = path.join(dir, 'stale-readonly.json');
    fs.writeFileSync(file + '.tmp', 'stale', { mode: 0o444 });

    expect(writeJsonAtomic(file, { apiKey: 'sk-xxx' }, { mode: 0o600 })).toBe(true);
    expect(readJson(file, 'test')).toEqual({ apiKey: 'sk-xxx' });
  });

  // Windows has no POSIX permission bits — Node maps `mode` onto the read-only
  // flag only — so the bits can only be asserted where they exist.
  it.skipIf(process.platform === 'win32')('locks the file to its owner when asked', () => {
    const file = path.join(dir, 'secret.json');

    expect(writeJsonAtomic(file, { apiKey: 'sk-xxx' }, { mode: 0o600 })).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')(
    'still locks it when a wide-open temp file was left behind',
    () => {
      const file = path.join(dir, 'secret2.json');
      // fs.writeFileSync only honors `mode` when it creates the file, so a temp
      // left by a crashed run would otherwise hand its 0644 to the roster —
      // publishing the keys inside it to every account on the machine.
      fs.writeFileSync(file + '.tmp', 'stale', { mode: 0o644 });

      expect(writeJsonAtomic(file, { apiKey: 'sk-xxx' }, { mode: 0o600 })).toBe(true);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    },
  );
});
