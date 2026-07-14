/**
 * Unit tests for the pure tool-call summarization helpers.
 *
 * Covers (per toolSummary.ts):
 *   1. summarizeToolCall — known tools (Edit/Bash/Read/Grep/delegate), no
 *      input, unknown tool, and truncated/broken JSON — none of these throw.
 *   2. formatToolInput   — pretty-print on valid JSON, raw text on broken JSON.
 *   3. editDiffFields    — Edit-only, undefined when fields are missing.
 *   4. shortenPath / displayToolName / categorizeTool — small pure helpers.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  categorizeTool,
  displayToolName,
  editDiffFields,
  formatToolInput,
  shortenPath,
  summarizeToolCall,
} from '../src/components/toolSummary.js';

// ── 1. summarizeToolCall — known tools, valid JSON ─────────────

test('summarizeToolCall(Edit) shows the last two path segments, not the full absolute path', () => {
  const input = JSON.stringify({
    file_path: 'F:\\Projects\\ai-office\\webview-ui\\src\\components\\EmployeeChat.tsx',
    old_string: 'a',
    new_string: 'b',
  });
  assert.equal(summarizeToolCall('Edit', input), 'components/EmployeeChat.tsx');
});

test('summarizeToolCall(Bash) shows the command', () => {
  const input = JSON.stringify({ command: 'npm run build' });
  assert.equal(summarizeToolCall('Bash', input), 'npm run build');
});

test('summarizeToolCall(Bash) collapses a multi-line command onto one line', () => {
  const input = JSON.stringify({ command: 'echo one\necho two' });
  assert.equal(summarizeToolCall('Bash', input), 'echo one echo two');
});

test('summarizeToolCall(Read) shortens the path the same way Edit does', () => {
  const input = JSON.stringify({ file_path: '/home/user/project/README.md' });
  assert.equal(summarizeToolCall('Read', input), 'project/README.md');
});

test('summarizeToolCall(Grep) shows the pattern', () => {
  const input = JSON.stringify({ pattern: 'ChatEntry', path: 'src' });
  assert.equal(summarizeToolCall('Grep', input), 'ChatEntry');
});

test('summarizeToolCall(mcp__office__delegate) reads name and instruction from the office tool schema', () => {
  const input = JSON.stringify({ name: '코더', instruction: '버튼 색을 danger 토큰으로 바꿔줘' });
  assert.equal(
    summarizeToolCall('mcp__office__delegate', input),
    '코더에게: 버튼 색을 danger 토큰으로 바꿔줘',
  );
});

test('summarizeToolCall(mcp__office__delegate) falls back to "위임" when instruction is missing', () => {
  const input = JSON.stringify({ name: '코더' });
  assert.equal(summarizeToolCall('mcp__office__delegate', input), '코더에게 위임');
});

// ── 2. summarizeToolCall — degrades without throwing ───────────

test('summarizeToolCall returns the bare tool name when input is undefined', () => {
  assert.equal(summarizeToolCall('Edit', undefined), 'Edit');
});

test('summarizeToolCall returns the bare tool name for an unrecognized tool, even with input', () => {
  assert.equal(
    summarizeToolCall('SomeFutureTool', JSON.stringify({ whatever: 1 })),
    'SomeFutureTool',
  );
});

test('summarizeToolCall never throws on input that is not JSON at all', () => {
  assert.doesNotThrow(() => summarizeToolCall('Edit', 'not json { at all'));
  assert.equal(summarizeToolCall('Edit', 'not json { at all'), 'Edit');
});

test('summarizeToolCall recovers file_path from JSON truncated after that field (2000-char cap)', () => {
  // Simulates employee.ts's TOOL_INPUT_MAX cutting the string mid-old_string,
  // well past file_path — the whole payload no longer parses as JSON.
  const truncated =
    '{"file_path":"F:\\\\Projects\\\\ai-office\\\\server\\\\src\\\\employees.ts","old_string":"function reallyLongContext(';
  assert.doesNotThrow(() => summarizeToolCall('Edit', truncated));
  assert.equal(summarizeToolCall('Edit', truncated), 'src/employees.ts');
});

test('summarizeToolCall falls back to the tool name when even the recovered field is missing', () => {
  const truncated = '{"unrelated_field":"some val';
  assert.equal(summarizeToolCall('Edit', truncated), 'Edit');
});

// ── 3. formatToolInput ──────────────────────────────────────────

test('formatToolInput pretty-prints input that parses as JSON', () => {
  const input = JSON.stringify({ command: 'npm test' });
  assert.equal(formatToolInput(input), JSON.stringify({ command: 'npm test' }, null, 2));
});

test('formatToolInput returns the raw text as-is when JSON parsing fails', () => {
  const broken = '{"command":"npm test", "cwd":"F:\\\\Proj';
  assert.equal(formatToolInput(broken), broken);
});

test('formatToolInput returns an empty string for undefined input', () => {
  assert.equal(formatToolInput(undefined), '');
});

// ── 4. editDiffFields ────────────────────────────────────────────

test('editDiffFields extracts old_string/new_string for a clean Edit call', () => {
  const input = JSON.stringify({
    file_path: 'a.ts',
    old_string: 'const x = 1;',
    new_string: 'const x = 2;',
  });
  assert.deepEqual(editDiffFields('Edit', input), {
    oldString: 'const x = 1;',
    newString: 'const x = 2;',
  });
});

test('editDiffFields returns undefined for a non-Edit tool', () => {
  const input = JSON.stringify({ old_string: 'a', new_string: 'b' });
  assert.equal(editDiffFields('Bash', input), undefined);
});

test('editDiffFields returns undefined when new_string was cut off by truncation', () => {
  const truncated = '{"file_path":"a.ts","old_string":"const x = 1;"';
  assert.equal(editDiffFields('Edit', truncated), undefined);
});

test('editDiffFields returns undefined for undefined input', () => {
  assert.equal(editDiffFields('Edit', undefined), undefined);
});

// ── 5. shortenPath / displayToolName / categorizeTool ───────────

test('shortenPath keeps the last two segments of a Windows path', () => {
  assert.equal(shortenPath('F:\\Projects\\ai-office\\webview-ui\\src\\App.tsx'), 'src/App.tsx');
});

test('shortenPath keeps the last two segments of a POSIX path', () => {
  assert.equal(shortenPath('/home/user/project/src/App.tsx'), 'src/App.tsx');
});

test('shortenPath returns a single-segment path unchanged', () => {
  assert.equal(shortenPath('App.tsx'), 'App.tsx');
});

test('displayToolName translates office delegation tools, passes everything else through', () => {
  assert.equal(displayToolName('mcp__office__delegate'), '위임');
  assert.equal(displayToolName('Edit'), 'Edit');
});

test('categorizeTool groups read/write/exec/delegate correctly and falls back to other', () => {
  assert.equal(categorizeTool('Read'), 'read');
  assert.equal(categorizeTool('Edit'), 'write');
  assert.equal(categorizeTool('Bash'), 'exec');
  assert.equal(categorizeTool('mcp__office__delegate'), 'delegate');
  assert.equal(categorizeTool('AskUserQuestion'), 'other');
});
