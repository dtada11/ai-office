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

// ── 5. Full bug-report timeline — the deadlock, end to end ──────
//
// The isolated tests above prove each operation in seclusion. This one replays
// the exact sequence from the field report — "요청 5건 → 응답 2건 → 3건 영구
// 대기 → 정지" — as one interleaved timeline, which is where the bug actually
// bit: parallel requests landing, a few answered, the rest left hanging. It
// pins two invariants across the whole run:
//   (a) no request is ever dropped — every one of the five stays answerable
//       until it is the one resolved (the old single-slot code lost 3 of 5);
//   (b) the bubble gate (`queue.length > 0`, exactly what the handler uses to
//       decide `clearPermissionBubble`) stays up through the partial drain and
//       falls only when the last request clears — never one-and-done.

test('the 5→2→3 field-report timeline drains fully with no request lost and the bubble gated to empty', () => {
  const bubbleVisible = () => queue.length > 0;
  let queue: PermissionRequest[] = [];

  // Claude fans out: five tool calls arrive before the user answers any.
  for (const id of ['a', 'b', 'c', 'd', 'e']) queue = enqueuePermission(queue, req(id));
  assert.deepEqual(
    queue.map((p) => p.requestId),
    ['a', 'b', 'c', 'd', 'e'],
    'all five parallel requests are held — none overwritten',
  );
  assert.equal(bubbleVisible(), true);

  // The user answers two. Under the old code the other three were already gone;
  // here they must still be present and answerable.
  queue = dequeuePermission(queue, 'a');
  queue = dequeuePermission(queue, 'b');
  assert.deepEqual(
    queue.map((p) => p.requestId),
    ['c', 'd', 'e'],
    'the three unanswered requests survive — this is the exact deadlock',
  );
  assert.equal(bubbleVisible(), true, 'bubble stays up: work remains');

  // Drain the rest. The bubble must remain visible until the final resolve.
  queue = dequeuePermission(queue, 'c');
  assert.equal(bubbleVisible(), true);
  queue = dequeuePermission(queue, 'd');
  assert.equal(bubbleVisible(), true, 'still one left — not one-and-done');
  queue = dequeuePermission(queue, 'e');
  assert.equal(queue.length, 0);
  assert.equal(bubbleVisible(), false, 'bubble falls only when the queue empties');
});

test('a late resolve for an already-answered request is inert (optimistic clear beat the server round-trip)', () => {
  let queue = [req('a'), req('b')];
  // Optimistic local clear removes 'a' the moment the user decides.
  queue = dequeuePermission(queue, 'a');
  // The server's agentPermissionResolved for 'a' arrives afterward. dequeue
  // returns the same reference, so the handler's `next === queue` guard makes
  // it a no-op — it must not disturb 'b' or wrongly drop the bubble.
  const afterLate = dequeuePermission(queue, 'a');
  assert.equal(afterLate, queue, 'late duplicate resolve is a reference-stable no-op');
  assert.deepEqual(
    afterLate.map((p) => p.requestId),
    ['b'],
    'the still-pending request is untouched',
  );
});
