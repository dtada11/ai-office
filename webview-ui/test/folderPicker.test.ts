/**
 * Unit tests for the pure folder-picker navigation helpers (folderPicker.ts).
 *
 * The picker's fetch + rendering (FolderPicker.tsx) is deliberately not
 * covered here -- this project's webview tests run in a Node environment
 * with no DOM, so component rendering isn't testable this way. What matters
 * for correctness is the navigation logic: drill down goes to the clicked
 * entry, "go up" goes to the reported parent (or is a no-op at the top), and
 * "select" only confirms a real, successfully-loaded path.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { DirListing } from '../src/folderPicker.js';
import {
  collapseBreadcrumb,
  confirmedCwd,
  nextRequestPath,
  pathSegments,
} from '../src/folderPicker.js';

function listing(overrides: Partial<DirListing> = {}): DirListing {
  return { path: 'C:\\Users\\me', parent: 'C:\\Users', entries: [], error: false, ...overrides };
}

// ── nextRequestPath: drillDown ──────────────────────────────────

test('drillDown requests the clicked entry’s path, regardless of current listing', () => {
  const entry = { name: 'projects', path: 'C:\\Users\\me\\projects' };
  assert.equal(nextRequestPath(listing(), { type: 'drillDown', entry }), 'C:\\Users\\me\\projects');
  assert.equal(nextRequestPath(null, { type: 'drillDown', entry }), 'C:\\Users\\me\\projects');
});

// ── nextRequestPath: goToParent ──────────────────────────────────

test('goToParent requests the listing’s reported parent', () => {
  const current = listing({ path: 'C:\\Users\\me\\projects', parent: 'C:\\Users\\me' });
  assert.equal(nextRequestPath(current, { type: 'goToParent' }), 'C:\\Users\\me');
});

test('goToParent is a no-op when parent is null (already at the top)', () => {
  const atTop = listing({ path: '/', parent: null });
  assert.equal(nextRequestPath(atTop, { type: 'goToParent' }), null);
});

test('goToParent is a no-op with no listing loaded yet', () => {
  assert.equal(nextRequestPath(null, { type: 'goToParent' }), null);
});

// ── confirmedCwd ──────────────────────────────────────────────────

test('confirmedCwd returns the current path for a successfully loaded listing', () => {
  const current = listing({ path: 'C:\\Users\\me\\projects' });
  assert.equal(confirmedCwd(current), 'C:\\Users\\me\\projects');
});

test('confirmedCwd returns null when nothing has loaded yet', () => {
  assert.equal(confirmedCwd(null), null);
});

test('confirmedCwd returns null when the listing failed to load', () => {
  const failed = listing({ path: 'C:\\locked', error: true });
  assert.equal(confirmedCwd(failed), null);
});

test("confirmedCwd returns null at the '' starting screen (drive list, not a real folder)", () => {
  const start = listing({ path: '', parent: null });
  assert.equal(confirmedCwd(start), null);
});

// ── pathSegments ────────────────────────────────────────────────

test('pathSegments returns [] for the empty starting-screen path', () => {
  assert.deepEqual(pathSegments(''), []);
});

test('pathSegments breaks a Windows drive path into root-to-leaf crumbs', () => {
  assert.deepEqual(pathSegments('C:\\Users\\me\\projects'), [
    { label: 'C:\\', path: 'C:\\' },
    { label: 'Users', path: 'C:\\Users' },
    { label: 'me', path: 'C:\\Users\\me' },
    { label: 'projects', path: 'C:\\Users\\me\\projects' },
  ]);
});

test('pathSegments handles a bare Windows drive root as a single crumb', () => {
  assert.deepEqual(pathSegments('C:\\'), [{ label: 'C:\\', path: 'C:\\' }]);
});

test('pathSegments breaks a POSIX absolute path into root-to-leaf crumbs', () => {
  assert.deepEqual(pathSegments('/home/me/projects'), [
    { label: '/', path: '/' },
    { label: 'home', path: '/home' },
    { label: 'me', path: '/home/me' },
    { label: 'projects', path: '/home/me/projects' },
  ]);
});

test('pathSegments handles the POSIX root as a single crumb', () => {
  assert.deepEqual(pathSegments('/'), [{ label: '/', path: '/' }]);
});

// ── collapseBreadcrumb ─────────────────────────────────────────

test('collapseBreadcrumb is a no-op when there are tailCount+1 or fewer segments', () => {
  const segments = pathSegments('C:\\Users\\me');
  assert.deepEqual(collapseBreadcrumb(segments), segments);
});

test('collapseBreadcrumb keeps the root and the last two segments, with one ellipsis between', () => {
  const segments = pathSegments('C:\\Users\\me\\work\\projects\\deep\\nested');
  assert.deepEqual(collapseBreadcrumb(segments), [
    { label: 'C:\\', path: 'C:\\' },
    { ellipsis: true },
    { label: 'deep', path: 'C:\\Users\\me\\work\\projects\\deep' },
    { label: 'nested', path: 'C:\\Users\\me\\work\\projects\\deep\\nested' },
  ]);
});

test('collapseBreadcrumb respects a custom tailCount', () => {
  const segments = pathSegments('/a/b/c/d/e');
  assert.deepEqual(collapseBreadcrumb(segments, 1), [
    { label: '/', path: '/' },
    { ellipsis: true },
    { label: 'e', path: '/a/b/c/d/e' },
  ]);
});
