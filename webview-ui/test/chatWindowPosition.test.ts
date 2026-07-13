/**
 * Unit tests for the pure chat-window position/z-order helpers.
 *
 * Covers (per chatWindowPosition.ts):
 *   1. initialChatPosition — staggered open position by window index
 *   2. clampChatPosition   — keep enough of the header on screen
 *   3. bringToFront        — z-order = render order = array order
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  bringToFront,
  clampChatPosition,
  initialChatPosition,
} from '../src/components/chatWindowPosition.js';
import {
  CHAT_HEADER_VISIBLE_PX,
  CHAT_MIN_VISIBLE_PX,
  CHAT_STAGGER_PX,
  CHAT_START_PX,
} from '../src/constants.js';

// ── 1. initialChatPosition ────────────────────────────────────

test('initialChatPosition(0) starts at the base offset', () => {
  assert.deepEqual(initialChatPosition(0), { x: CHAT_START_PX, y: CHAT_START_PX });
});

test('initialChatPosition(n) staggers x by n * CHAT_STAGGER_PX, y fixed', () => {
  assert.deepEqual(initialChatPosition(3), {
    x: CHAT_START_PX + 3 * CHAT_STAGGER_PX,
    y: CHAT_START_PX,
  });
});

// ── 2. clampChatPosition ──────────────────────────────────────

test('clampChatPosition clips negative coordinates to 0', () => {
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(clampChatPosition({ x: -100, y: -50 }, viewport), { x: 0, y: 0 });
});

test('clampChatPosition stops at viewport.width - CHAT_MIN_VISIBLE_PX on the right', () => {
  const viewport = { width: 1200, height: 800 };
  const result = clampChatPosition({ x: 5000, y: 100 }, viewport);
  assert.equal(result.x, viewport.width - CHAT_MIN_VISIBLE_PX);
});

test('clampChatPosition stops at viewport.height - CHAT_HEADER_VISIBLE_PX on the bottom', () => {
  const viewport = { width: 1200, height: 800 };
  const result = clampChatPosition({ x: 100, y: 5000 }, viewport);
  assert.equal(result.y, viewport.height - CHAT_HEADER_VISIBLE_PX);
});

test('clampChatPosition never returns negative values even for a viewport smaller than the constants', () => {
  const viewport = { width: 40, height: 20 };
  const result = clampChatPosition({ x: 5000, y: 5000 }, viewport);
  assert.ok(result.x >= 0, `expected x >= 0, got ${result.x}`);
  assert.ok(result.y >= 0, `expected y >= 0, got ${result.y}`);
});

test('clampChatPosition passes through in-range coordinates unchanged', () => {
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(clampChatPosition({ x: 300, y: 200 }, viewport), { x: 300, y: 200 });
});

// ── 3. bringToFront ────────────────────────────────────────────

test('bringToFront moves the target id to the end of the array', () => {
  assert.deepEqual(bringToFront([1, 2, 3], 1), [2, 3, 1]);
});

test('bringToFront leaves order unchanged when the id is already last', () => {
  assert.deepEqual(bringToFront([1, 2, 3], 3), [1, 2, 3]);
});

test('bringToFront returns the original array when the id is not present', () => {
  const input = [1, 2, 3];
  assert.deepEqual(bringToFront(input, 99), [1, 2, 3]);
});

test('bringToFront does not mutate the input array', () => {
  const input = [1, 2, 3];
  bringToFront(input, 2);
  assert.deepEqual(input, [1, 2, 3]);
});
