import { describe, expect, it } from 'vitest';

import { ClaudeEmployee, type EmployeeEvent } from '../src/employee.js';

/** ClaudeEmployee.handle() only needs `host.onEvent` — it never touches `q`/`push`,
 *  so it can be driven directly without starting a real (or mocked) SDK session. */
function makeEmployee(): { employee: ClaudeEmployee; events: EmployeeEvent[] } {
  const events: EmployeeEvent[] = [];
  const employee = new ClaudeEmployee(
    '코더',
    '/work',
    { onEvent: (event) => events.push(event), askPermission: async () => true },
    { mode: 'subscription' } as never,
  );
  return { employee, events };
}

/** `handle` is private — reached the same way the SDK's pump() would call it. */
function handle(employee: ClaudeEmployee, msg: Record<string, unknown>): void {
  (employee as unknown as { handle(msg: Record<string, unknown>): void }).handle(msg);
}

function assistantMessage(content: unknown[]): Record<string, unknown> {
  return { type: 'assistant', message: { content } };
}

describe('ClaudeEmployee — tool_use blocks', () => {
  it('input을 JSON 문자열 그대로 실어 tool 이벤트를 발행한다', () => {
    const { employee, events } = makeEmployee();

    handle(
      employee,
      assistantMessage([
        { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts', old_string: 'x' } },
      ]),
    );

    expect(events).toContainEqual({
      kind: 'tool',
      text: 'Edit',
      input: '{"file_path":"/a.ts","old_string":"x"}',
    });
  });

  it('input이 없어도 이벤트는 발행되고(도구 이름만이라도 남는다) input은 undefined다', () => {
    const { employee, events } = makeEmployee();

    handle(employee, assistantMessage([{ type: 'tool_use', name: 'Bash' }]));

    expect(events).toContainEqual({ kind: 'tool', text: 'Bash', input: undefined });
  });

  it('순환 참조라 stringify가 실패해도 이벤트는 여전히 발행되고 input은 undefined다', () => {
    const { employee, events } = makeEmployee();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    handle(employee, assistantMessage([{ type: 'tool_use', name: 'Read', input: circular }]));

    expect(events).toContainEqual({ kind: 'tool', text: 'Read', input: undefined });
  });

  it('TOOL_INPUT_MAX(2000자)를 넘는 input은 잘린다', () => {
    const { employee, events } = makeEmployee();
    const longValue = 'x'.repeat(3000);

    handle(
      employee,
      assistantMessage([{ type: 'tool_use', name: 'Write', input: { content: longValue } }]),
    );

    const toolEvent = events.find((e) => e.kind === 'tool') as { input?: string } | undefined;
    expect(toolEvent?.input).toHaveLength(2000);
  });

  it('text 블록은 그대로 text 이벤트로 발행된다(회귀 확인)', () => {
    const { employee, events } = makeEmployee();

    handle(employee, assistantMessage([{ type: 'text', text: '안녕하세요' }]));

    expect(events).toContainEqual({ kind: 'text', text: '안녕하세요' });
  });
});
