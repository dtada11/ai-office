/**
 * Unit tests for the pure permission-queue helpers (permissionQueue.ts).
 *
 * This is the regression test for the parallel-tool-call deadlock: Claude
 * calls tools in parallel, so several permission requests can land for the
 * same employee before the user answers any of them. The old code kept a
 * single `PermissionRequest | undefined` slot per employee and silently
 * overwrote it on the second request — the overwritten one had no way left
 * to be answered, and its tool call stayed parked on the server forever,
 * hanging the whole session.
 *
 * Covers:
 *   1. enqueuePermission — three requests for one employee all queue, none dropped
 *   2. dequeuePermission — resolving the middle one removes only that one
 *   3. enqueuePermission — a duplicate requestId (e.g. a reconnect re-delivery) queues once
 *   4. dequeuePermission — queue length is what gates the permission bubble:
 *      it reaches 0 only once every request is resolved, and stays > 0 with one left
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { PermissionRequest } from '../src/hooks/permissionQueue.js';
import { dequeuePermission, enqueuePermission } from '../src/hooks/permissionQueue.js';

function req(requestId: string): PermissionRequest {
  return { requestId, toolName: 'Read', title: '', input: '{}' };
}

// ── 1. enqueuePermission — parallel requests all queue ─────────

test('enqueuePermission queues three requests for the same employee, none dropped', () => {
  let queue: PermissionRequest[] = [];
  queue = enqueuePermission(queue, req('a'));
  queue = enqueuePermission(queue, req('b'));
  queue = enqueuePermission(queue, req('c'));
  assert.deepEqual(
    queue.map((p) => p.requestId),
    ['a', 'b', 'c'],
  );
});

test('enqueuePermission does not mutate the input array', () => {
  const original: PermissionRequest[] = [req('a')];
  enqueuePermission(original, req('b'));
  assert.deepEqual(
    original.map((p) => p.requestId),
    ['a'],
  );
});

// ── 2. dequeuePermission — deciding one leaves the others ───────

test('dequeuePermission on the middle request removes only that one', () => {
  const queue = [req('a'), req('b'), req('c')];
  const next = dequeuePermission(queue, 'b');
  assert.deepEqual(
    next.map((p) => p.requestId),
    ['a', 'c'],
  );
});

test('dequeuePermission does not mutate the input array', () => {
  const queue = [req('a'), req('b'), req('c')];
  dequeuePermission(queue, 'b');
  assert.deepEqual(
    queue.map((p) => p.requestId),
    ['a', 'b', 'c'],
  );
});

// ── 3. enqueuePermission — duplicate requestId queues once ──────

test('enqueuePermission ignores a duplicate requestId (e.g. reconnect re-delivery)', () => {
  let queue: PermissionRequest[] = [];
  queue = enqueuePermission(queue, req('a'));
  queue = enqueuePermission(queue, req('a'));
  assert.equal(queue.length, 1);
});

test('enqueuePermission returns the same array reference on a duplicate (no re-render)', () => {
  const queue = [req('a')];
  const next = enqueuePermission(queue, req('a'));
  assert.equal(next, queue);
});

// ── 4. dequeuePermission — queue length gates the permission bubble ─

test('dequeuePermission empties the queue once the last request is resolved', () => {
  const queue = [req('a')];
  const next = dequeuePermission(queue, 'a');
  assert.equal(next.length, 0);
});

test('dequeuePermission leaves the queue non-empty with one request still pending', () => {
  const queue = [req('a'), req('b')];
  const next = dequeuePermission(queue, 'a');
  assert.equal(next.length, 1);
});

test('dequeuePermission returns the same array reference when the id is not queued', () => {
  const queue = [req('a'), req('b')];
  const next = dequeuePermission(queue, 'not-in-queue');
  assert.equal(next, queue);
});

test('dequeuePermission on an already-empty queue is a safe no-op', () => {
  const queue: PermissionRequest[] = [];
  const next = dequeuePermission(queue, 'a');
  assert.equal(next, queue);
  assert.equal(next.length, 0);
});
