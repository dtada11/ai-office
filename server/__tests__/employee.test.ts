import { describe, expect, it } from 'vitest';

import {
  buildPromptBlocks,
  ClaudeEmployee,
  type Delegation,
  type EmployeeEvent,
  leadDisallowedTools,
} from '../src/employee.js';

const fakeDelegation: Delegation = {
  listStaff: () => '',
  delegate: () => '',
  collect: async () => '',
};

/** ClaudeEmployee.handle() only needs `host.onEvent` — it never touches `q`/`push`,
 *  so it can be driven directly without starting a real (or mocked) SDK session. */
function makeEmployee(): { employee: ClaudeEmployee; events: EmployeeEvent[] } {
  const events: EmployeeEvent[] = [];
  const employee = new ClaudeEmployee(
    '코더',
    '/work',
    { onEvent: (event) => events.push(event), askPermission: async () => true },
    { mode: 'subscription' } as never,
    '코더-0f1e2d3c',
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

describe('leadDisallowedTools — 팀장에게 내장 서브에이전트 도구를 금지', () => {
  it('delegation이 있으면(팀장) Task와 Agent를 둘 다 막는다', () => {
    expect(leadDisallowedTools(fakeDelegation)).toEqual(['Task', 'Agent']);
  });

  it('delegation이 없으면(스태프) 아무것도 안 막는다', () => {
    expect(leadDisallowedTools(undefined)).toBeUndefined();
  });
});

describe('buildPromptBlocks — 정체성 + 팀장 전용 리드 지침 블록', () => {
  it('delegation이 있으면(팀장) 정체성이 팀장이고 리드 지침 블록이 들어간다', () => {
    const blocks = buildPromptBlocks('김팀장', fakeDelegation, undefined, undefined);
    expect(blocks[0]).toContain("팀장 '김팀장'");
    expect(blocks.some((b) => b.includes('## 리드 지침'))).toBe(true);
  });

  it('delegation이 없으면(스태프) 정체성이 팀원이고 리드 지침 블록이 없다', () => {
    const blocks = buildPromptBlocks('개발자', undefined, undefined, undefined);
    expect(blocks[0]).toContain("팀원 '개발자'");
    expect(blocks[0]).toContain('팀장이 아니며');
    expect(blocks.some((b) => b.includes('## 리드 지침'))).toBe(false);
  });

  it('스태프도 persona/handoff가 없어도 정체성 블록 하나는 항상 갖는다(빈 프롬프트 방지)', () => {
    const blocks = buildPromptBlocks('개발자', undefined, undefined, undefined);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("팀원 '개발자'");
  });

  it('리드 지침 블록은 persona 유무와 무관하게 delegation만으로 결정된다', () => {
    const blocks = buildPromptBlocks('김팀장', fakeDelegation, '', undefined);
    expect(blocks.some((b) => b.includes('## 리드 지침'))).toBe(true);
    // persona가 비어 있으면 직원 지침 블록 자체는 안 생긴다(기존 동작 회귀 확인).
    expect(blocks.some((b) => b.includes('## 직원 지침'))).toBe(false);
  });

  it('persona/handoffNote 블록은 정체성 뒤에 기존과 동일하게 붙는다(회귀 확인)', () => {
    const blocks = buildPromptBlocks('개발자', undefined, '친절하게 답하라', '어제 못다한 일: X');
    expect(blocks).toEqual([
      "너는 이 픽셀 사무실의 팀원 '개발자'이다. 팀장이 아니며, 팀장이 위임한 일을 네 담당 폴더 기준으로 처리한다.",
      '## 직원 지침\n친절하게 답하라',
      '## 인수인계 노트\n아래는 당신이 직전 근무를 마치며 남긴 인수인계 노트다. 이어서 업무를 진행하라.\n\n어제 못다한 일: X',
    ]);
  });
});
