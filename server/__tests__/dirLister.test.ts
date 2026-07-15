import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listDirectory } from '../src/dirLister.js';

describe('listDirectory', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-dirlister-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 1. Returns only subdirectories, never files.
  it('lists subdirectories and excludes files', () => {
    fs.mkdirSync(path.join(tmpRoot, 'sub-a'));
    fs.mkdirSync(path.join(tmpRoot, 'sub-b'));
    fs.writeFileSync(path.join(tmpRoot, 'a-file.txt'), 'x');

    const result = listDirectory(tmpRoot);

    expect(result.error).toBe(false);
    expect(result.entries.map((e) => e.name).sort()).toEqual(['sub-a', 'sub-b']);
  });

  // 2. Each entry carries its absolute path, not just a name.
  it('returns absolute paths for each entry', () => {
    fs.mkdirSync(path.join(tmpRoot, 'child'));

    const result = listDirectory(tmpRoot);

    expect(result.entries).toEqual([{ name: 'child', path: path.join(tmpRoot, 'child') }]);
  });

  // 3. Hidden directories (dotfiles) are filtered out of the default view.
  it('excludes dotfile directories', () => {
    fs.mkdirSync(path.join(tmpRoot, 'visible'));
    fs.mkdirSync(path.join(tmpRoot, '.hidden'));

    const result = listDirectory(tmpRoot);

    expect(result.entries.map((e) => e.name)).toEqual(['visible']);
  });

  // 4. Entries are sorted so the picker doesn't show filesystem order.
  it('sorts entries alphabetically', () => {
    fs.mkdirSync(path.join(tmpRoot, 'zeta'));
    fs.mkdirSync(path.join(tmpRoot, 'alpha'));
    fs.mkdirSync(path.join(tmpRoot, 'mu'));

    const result = listDirectory(tmpRoot);

    expect(result.entries.map((e) => e.name)).toEqual(['alpha', 'mu', 'zeta']);
  });

  // 5. A path that doesn't exist degrades to a safe error response, never throws.
  it('returns a safe error response for a nonexistent path', () => {
    const missing = path.join(tmpRoot, 'does-not-exist');

    expect(() => listDirectory(missing)).not.toThrow();
    const result = listDirectory(missing);

    expect(result.error).toBe(true);
    expect(result.entries).toEqual([]);
  });

  // 6. A path that resolves to a file (not a directory) is also a safe error.
  it('returns a safe error response for a path that is a file', () => {
    const filePath = path.join(tmpRoot, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'x');

    const result = listDirectory(filePath);

    expect(result.error).toBe(true);
    expect(result.entries).toEqual([]);
  });

  // 7. Permission-denied reads degrade to the same safe error shape (POSIX only --
  // chmod 0 has no effect on Windows, and this isn't the platform's own picker gate).
  it.skipIf(process.platform === 'win32')(
    'returns a safe error response when the directory cannot be read',
    () => {
      const locked = path.join(tmpRoot, 'locked');
      fs.mkdirSync(locked);
      fs.mkdirSync(path.join(locked, 'secret'));
      fs.chmodSync(locked, 0o000);

      try {
        expect(() => listDirectory(locked)).not.toThrow();
        const result = listDirectory(locked);
        expect(result.error).toBe(true);
        expect(result.entries).toEqual([]);
      } finally {
        fs.chmodSync(locked, 0o755); // restore so afterEach's rmSync can clean up
      }
    },
  );

  // 8. Parent path points back to the containing directory.
  it('computes the parent as the containing directory', () => {
    const child = path.join(tmpRoot, 'child');
    fs.mkdirSync(child);

    const result = listDirectory(child);

    expect(result.parent).toBe(path.resolve(tmpRoot));
  });

  // 9. A POSIX filesystem root has no parent to go up to.
  it.skipIf(process.platform === 'win32')('reports no parent above the POSIX root', () => {
    const result = listDirectory('/');
    expect(result.parent).toBeNull();
  });

  // 10. A Windows drive root's parent is the '' starting point (the drive list),
  // not null -- otherwise drilling into a drive would be a dead end.
  it.runIf(process.platform === 'win32')(
    "reports the '' starting point as a Windows drive root's parent",
    () => {
      const result = listDirectory('C:\\');
      expect(result.parent).toBe('');
    },
  );

  // 11. Empty input on Windows returns the drive list as the starting point.
  it.runIf(process.platform === 'win32')('lists drives for empty input on Windows', () => {
    const result = listDirectory('');
    expect(result.error).toBe(false);
    expect(result.path).toBe('');
    expect(result.parent).toBeNull();
    expect(result.entries.some((e) => /^[A-Za-z]:\\$/.test(e.path))).toBe(true);
  });

  // 12. Empty input on POSIX returns the home directory as the starting point.
  it.skipIf(process.platform === 'win32')(
    'lists the home directory for empty input on POSIX',
    () => {
      const result = listDirectory('');
      expect(result.error).toBe(false);
      expect(result.path).toBe(path.resolve(os.homedir()));
    },
  );

  // 13. Blank/whitespace-only input is treated the same as empty input.
  it('treats whitespace-only input as empty (starting point)', () => {
    const blank = listDirectory('   ');
    const empty = listDirectory('');
    expect(blank).toEqual(empty);
  });

  // 14. A directory symlink (Windows: junction) is listed, not silently dropped.
  // fs.readdirSync's Dirent.isDirectory() uses lstat semantics and is false for
  // symlinks/junctions (notably on Windows), so without following the link this
  // entry would vanish from the listing even though opening it directly works.
  it('includes a directory symlink/junction in the listing', () => {
    const real = path.join(tmpRoot, 'real-target');
    fs.mkdirSync(real);
    const link = path.join(tmpRoot, 'link-to-target');
    fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');

    const result = listDirectory(tmpRoot);

    expect(result.error).toBe(false);
    expect(result.entries.map((e) => e.name).sort()).toEqual(['link-to-target', 'real-target']);
  });

  // 15. A broken symlink/junction (target removed) is safely excluded, never thrown.
  it('excludes a broken symlink/junction without throwing', () => {
    const real = path.join(tmpRoot, 'will-be-removed');
    fs.mkdirSync(real);
    const link = path.join(tmpRoot, 'broken-link');
    fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    fs.rmSync(real, { recursive: true, force: true });

    expect(() => listDirectory(tmpRoot)).not.toThrow();
    const result = listDirectory(tmpRoot);
    expect(result.error).toBe(false);
    expect(result.entries.map((e) => e.name)).toEqual([]);
  });
});
