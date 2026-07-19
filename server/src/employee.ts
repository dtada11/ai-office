/**
 * Employee adapter boundary.
 *
 * An employee is one AI worker with its own session, folder and character.
 * Everything provider-specific (today: the Claude Agent SDK) lives behind the
 * `Employee` interface, and the events crossing this boundary are OUR types —
 * no SDK type leaves this file. Swapping in another provider later means
 * writing a second implementation, not touching the office.
 */

import { z } from 'zod';

import type { EmployeeProvider } from '../../core/src/messages.js';
import { buildEnv } from './aiProvider.js';
import { getContextLimit } from './claudeSettings.js';
import { checkAutoApproval, hasDangerousBashMetachars } from './toolPermissions.js';

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk', {
  with: { 'resolution-mode': 'import' },
});
type Query = ReturnType<Sdk['query']>;
type SdkPermissionResult = Awaited<
  ReturnType<NonNullable<NonNullable<Parameters<Sdk['query']>[0]['options']>['canUseTool']>>
>;
type SdkUserMessage =
  Parameters<Query['streamInput']>[0] extends AsyncIterable<infer M> ? M : never;

/** The SDK is ESM-only and this bundle is CJS; a plain import() would be
 *  downleveled to require() and fail at runtime, so keep it a real import. */
const importSdk = new Function(
  'return import("@anthropic-ai/claude-agent-sdk")',
) as () => Promise<Sdk>;

// ── The boundary types (provider-agnostic) ──────────────────────

export type EmployeeEvent =
  /** The session announced its id — the office binds a character to it here. */
  | { kind: 'ready'; sessionId: string }
  /** A chunk of the assistant's answer. */
  | { kind: 'text'; text: string }
  /** A tool the employee is using, by name. `input` is its raw JSON args —
   *  unset when the block carried none or it could not be stringified. */
  | { kind: 'tool'; text: string; input?: string }
  /** A turn finished. `text` is set only on error. `costUsd` is what the SESSION has
   *  cost in total so far (not this turn) — and the SDK prices subscription work too,
   *  so a non-zero figure here does not mean anyone was billed. */
  | { kind: 'result'; text: string; costUsd: number }
  /** Model and context fill, read back from the reply itself. */
  | { kind: 'usage'; model: string; contextTokens: number; contextLimit: number }
  /** The session is gone (crash or stop). */
  | { kind: 'ended'; text: string };

/** A tool call waiting for the user's approval. */
export interface PermissionAsk {
  requestId: string;
  toolName: string;
  title: string;
  /** Truncated JSON of the tool input, for display. */
  input: string;
}

/** What the office gives an employee: a place to report to, and a boss to ask. */
export interface EmployeeHost {
  onEvent(event: EmployeeEvent): void;
  /** Resolves once the user allows or denies. */
  askPermission(ask: PermissionAsk): Promise<boolean>;
}

/** What the lead can do that staff cannot: see the staff, hand work to them, and
 *  gather what came back. Passing this in is what makes an employee a lead —
 *  nobody else gets the tools. */
export interface Delegation {
  listStaff(): string;
  /** Hands an instruction to a team member and returns immediately with a status
   *  string — the member works in the background. Their answer comes later,
   *  from collect(). */
  delegate(name: string, instruction: string): string;
  /** A snapshot of the delegations outstanding right now: answers from whoever
   *  has finished, and a "작업 중" line for whoever has not. Never waits — a member
   *  still working keeps their slot for the next collect. */
  collect(): Promise<string>;
  /** Append one line to the board's history. */
  note(text: string): string;
  /** Replace the board's current plan wholesale. The lead's way of moving the
   *  team's shared state: staff read that section and work from it, so a changed
   *  plan reaches everyone through here rather than through member-to-member talk. */
  setPlan(plan: string): string;
}

export interface Employee {
  readonly name: string;
  readonly cwd: string;
  /** Set once the session reports it; the office keys its character off this. */
  readonly sessionId: string;
  start(
    model?: string,
    delegation?: Delegation,
    persona?: string,
    handoffNote?: string,
    /** Staff only — the lead writes to the board through `delegation`. Its presence
     *  is what gives a staffer the office MCP server at all. */
    note?: (text: string) => string,
  ): Promise<void>;
  send(text: string): void;
  setModel(model: string): Promise<void>;
  stop(): void;
}

/** Tool inputs go to the client as raw JSON — the webview owns how they read.
 *  Capped because an Edit's old_string can be the whole file. */
const TOOL_INPUT_MAX = 2000;
function safeStringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : json.slice(0, TOOL_INPUT_MAX);
  } catch {
    return undefined; // 순환 참조 등 — 도구 이름만으로도 로그는 성립한다
  }
}

/** The SDK's own subagent spawners — blocked on the lead only. Exported bare so
 *  the wiring can be asserted without a real SDK session (see `start()`). */
export function leadDisallowedTools(delegation: Delegation | undefined): string[] | undefined {
  return delegation ? ['Task', 'Agent'] : undefined;
}

/** Told to the lead only, on top of the stock prompt — nudges them toward
 *  `mcp__office__delegate` instead of the SDK's own Task/Agent (which
 *  `leadDisallowedTools` then blocks outright). Not part of `persona`: that's
 *  user-edited and can be cleared, but this has to hold regardless. */
const LEAD_GUIDANCE_BLOCK = `## 리드 지침
너는 팀장이다. 일을 나눠 맡길 땐 반드시 \`list_staff\`로 팀원을 확인하고 \`delegate\`로 팀원에게 시킨 뒤 \`collect\`로 결과를 모아라. 네 세션 안에서 서브에이전트를 직접 만들지 마라 — 우리 사무실의 팀원들이 실제로 일하는 것이 이 도구의 목적이다. 위임 지시에는 팀원이 헛일을 반복하지 않도록 필요한 맥락(무엇을, 어느 폴더 기준으로, 무엇을 확인할지)을 담아라.

### 보드가 팀의 중심이다
팀원끼리는 서로 대화하지 않는다. 한 팀원이 알아낸 것이 다른 팀원에게 닿는 **유일한 경로는 회의록 보드이고, 그 보드를 고치는 사람은 너뿐이다.**

- 일을 나누기 전에 \`set_plan\`으로 **전체 계획과 역할별 분배를 보드에 먼저 적어라.** 팀원은 이걸 읽고 자기 일이 전체 어디에 붙는지 이해한다.
- 팀원 답에 질문이나 수정 의견이 있으면 **네가 판단해서 결정한다.** 그 결정으로 계획이 바뀌면 **반드시 \`set_plan\`으로 보드를 먼저 갱신하고, 그 다음에 \`delegate\`하라.** 순서가 뒤집히면 팀원이 옛 계획을 읽는다.
- \`set_plan\`은 누적이 아니라 교체다. 바뀐 부분만 적지 말고 **지금 유효한 계획 전체**를 적어라.

### collect는 기다리지 않는다
\`collect\`는 **지금까지 끝난 결과만** 준다. "작업 중"으로 나온 팀원은 아직 일하는 중이고, 그 결과는 사라진 게 아니라 다음 \`collect\`에서 받는다. 그러니 한 명이 끝나면 **다른 팀원을 기다리지 말고 바로 답을 주고 다시 시켜라.** 이게 팀이 동시에 움직이는 방식이다.

### 작업은 잘게 쪼개서 맡겨라
팀원은 **지시받는 순간에만** 보드를 읽는다. 한 번에 오래 걸리는 일을 맡기면 그사이 바뀐 계획을 모른 채 끝내서 헛일이 된다. 큰 일은 여러 번에 나눠 맡기고, 매번 보드를 최신으로 유지해라.`;

/** Every employee's first line: who they are and where they stand in the org.
 *  Without it a staffer has no system prompt at all when they carry no persona,
 *  so asked "are you the lead?" they just agree. Leads still get the fuller
 *  LEAD_GUIDANCE_BLOCK on top; this only settles identity. */
function identityBlock(name: string, isLead: boolean): string {
  return isLead
    ? `너는 이 픽셀 사무실의 팀장 '${name}'이다.`
    : `너는 이 픽셀 사무실의 팀원 '${name}'이다. 팀장이 아니며, 팀장이 위임한 일을 네 담당 폴더 기준으로 처리한다.`;
}

/** What this employee is told about themselves, on top of the stock prompt —
 *  who they are first, then lead guidance (delegation only), then whatever the
 *  persona editor added, then a handoff note if they're resuming a shift.
 *  Exported bare (no class needed) so the wiring can be asserted without a real
 *  SDK session. */
export function buildPromptBlocks(
  name: string,
  delegation: Delegation | undefined,
  persona: string | undefined,
  handoffNote: string | undefined,
): string[] {
  return [
    identityBlock(name, !!delegation),
    delegation ? LEAD_GUIDANCE_BLOCK : null,
    persona?.trim() ? `## 직원 지침\n${persona.trim()}` : null,
    handoffNote?.trim()
      ? `## 인수인계 노트\n아래는 당신이 직전 근무를 마치며 남긴 인수인계 노트다. 이어서 업무를 진행하라.\n\n${handoffNote.trim()}`
      : null,
  ].filter((block): block is string => block !== null);
}

// ── Claude implementation ───────────────────────────────────────

export class ClaudeEmployee implements Employee {
  private q: Query | null = null;
  private push: ((text: string) => void) | null = null;
  private model = '';
  private contextTokens = 0;
  sessionId = '';

  constructor(
    readonly name: string,
    readonly cwd: string,
    private readonly host: EmployeeHost,
    /** The AI this employee is plugged into — already resolved against the
     *  office default, so this is exactly what the session will authenticate with. */
    private readonly provider: EmployeeProvider,
    /** Whose allowlist canUseTool consults — minted by the office at hire time
     *  and handed in, never computed here. Deriving it from `this.name` is what
     *  let a fired employee's allowances land on the next hire of the same name;
     *  an employee carries their identity rather than recomputing it. */
    private readonly permissionKey: string,
  ) {}

  async start(
    model?: string,
    delegation?: Delegation,
    persona?: string,
    handoffNote?: string,
    note?: (text: string) => string,
  ): Promise<void> {
    const input = createInputStream();
    const sdk = await importSdk();
    const { query } = sdk;

    const promptBlocks = buildPromptBlocks(this.name, delegation, persona, handoffNote);
    const disallowedTools = leadDisallowedTools(delegation);
    const systemPrompt = promptBlocks.length
      ? {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: promptBlocks.join('\n\n---\n\n'),
        }
      : undefined;

    this.q = query({
      prompt: input.stream,
      options: {
        cwd: this.cwd,
        model,
        // Replaces the environment wholesale, so buildEnv carries PATH/HOME over.
        env: buildEnv(this.provider),
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(delegation || note
          ? { mcpServers: { office: officeTools(sdk, delegation, note) } }
          : {}),
        // The lead has mcp__office__delegate for handing work to real teammates —
        // the SDK's own Task/Agent just spawn ghosts inside the lead's own
        // session, which never move a hired employee's character. Barring them
        // here is what makes delegate the only way to fan work out. Staff have
        // no delegation, so they keep Task/Agent (their own subagent characters
        // still need it).
        ...(disallowedTools ? { disallowedTools } : {}),
        canUseTool: async (toolName, toolInput, options) => {
          // Delegating is the VP's job, not a privileged act — never ask for it.
          // Whatever the team member then does still needs the user's approval.
          if (toolName.startsWith('mcp__office__')) {
            return { behavior: 'allow' } as SdkPermissionResult;
          }

          // Stage 1 automode: the user's own allowlist, grown by clicking
          // "don't ask again". This is the single point where an allowlist is
          // actually enforced, so the key it reads has to be the same one the
          // settings panel writes — hence the office hands it in (see
          // allowlistKeyFor), rather than either side deriving its own.
          const permission = checkAutoApproval(this.permissionKey, toolName, toolInput);
          if (permission) {
            // Re-verify Bash metacharacters at matching time (file is untrusted input).
            // Fail-closed: if suspicious, fall through to human approval.
            if (toolName === 'Bash') {
              const command = (toolInput as { command?: string }).command;
              if (typeof command === 'string' && hasDangerousBashMetachars(command)) {
                // Suspicious Bash command — do not auto-approve despite allowlist entry
              } else {
                return { behavior: 'allow' } as SdkPermissionResult;
              }
            } else {
              return { behavior: 'allow' } as SdkPermissionResult;
            }
          }

          // Fall back to human approval
          const allowed = await this.host.askPermission({
            requestId: options.requestId,
            toolName,
            title: options.title ?? '',
            input: safeStringify(toolInput) ?? '',
          });
          return (
            allowed
              ? { behavior: 'allow' }
              : { behavior: 'deny', message: '사용자가 거부했습니다.' }
          ) as SdkPermissionResult;
        },
      },
    });
    this.push = input.push;

    void this.pump(this.q);
  }

  /** Read the session's stream and translate it into our own events. */
  private async pump(q: Query): Promise<void> {
    try {
      for await (const raw of q) {
        this.handle(raw as unknown as Record<string, unknown>);
      }
      this.host.onEvent({ kind: 'ended', text: '' });
    } catch (err) {
      this.host.onEvent({
        kind: 'ended',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handle(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    if (type === 'system' && (msg.subtype as string) === 'init') {
      // The session tells us its id — the office needs it to bind a character.
      this.sessionId = (msg.session_id as string) ?? '';
      if (this.sessionId) this.host.onEvent({ kind: 'ready', sessionId: this.sessionId });
      return;
    }

    if (type === 'assistant') {
      const message = msg.message as
        | {
            content?: unknown[];
            model?: string;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          }
        | undefined;

      // The reply names the model that produced it and carries its own usage —
      // exact, and no transcript parsing needed.
      const u = message?.usage;
      const context = u
        ? (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.output_tokens ?? 0)
        : 0;
      const modelChanged = !!message?.model && message.model !== this.model;
      const contextChanged = context > 0 && context !== this.contextTokens;
      if (message?.model) this.model = message.model;
      if (context > 0) this.contextTokens = context;
      if (modelChanged || contextChanged) {
        this.host.onEvent({
          kind: 'usage',
          model: this.model,
          contextTokens: this.contextTokens,
          contextLimit: getContextLimit(),
        });
      }

      for (const block of message?.content ?? []) {
        const b = block as { type: string; text?: string; name?: string; input?: unknown };
        if (b.type === 'text' && b.text) {
          this.host.onEvent({ kind: 'text', text: b.text });
        } else if (b.type === 'tool_use' && b.name) {
          this.host.onEvent({ kind: 'tool', text: b.name, input: safeStringify(b.input) });
        }
      }
      return;
    }

    if (type === 'result') {
      const result = msg as { is_error?: boolean; result?: string; total_cost_usd?: number };
      this.host.onEvent({
        kind: 'result',
        text: result.is_error ? `오류: ${result.result ?? '알 수 없음'}` : '',
        costUsd: result.total_cost_usd ?? 0,
      });
    }
  }

  send(text: string): void {
    this.push?.(text);
  }

  async setModel(model: string): Promise<void> {
    await this.q?.setModel(model);
  }

  stop(): void {
    this.q?.close();
    this.q = null;
    this.push = null;
  }
}

/** The office tools. Delegation is the lead's alone — that is what keeps work
 *  from fanning out further down the org chart. The board is shared: the lead
 *  owns the plan, everyone can add to the history. */
function officeTools(sdk: Sdk, delegation?: Delegation, note?: (text: string) => string) {
  const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

  const noteTool = (write: (t: string) => string) =>
    sdk.tool(
      'note',
      '팀 회의록의 "기록"에 한 줄 남긴다. 팀원은 진행 상황·막힌 지점·계획 변경 의견을, 팀장은 결정 근거를 남긴다.',
      { text: z.string().describe('남길 내용 한 줄') },
      async (args) => text(write(args.text)),
    );

  return sdk.createSdkMcpServer({
    name: 'office',
    tools: delegation
      ? [
          sdk.tool(
            'list_staff',
            '팀원 목록과 각자 담당 폴더, 지금 상태를 확인한다.',
            {},
            async () => text(delegation.listStaff()),
          ),
          sdk.tool(
            'delegate',
            '팀원에게 작업을 맡긴다. 기다리지 않고 즉시 반환된다 — 여러 팀원에게 연달아 맡길 수 있다. 결과는 collect로 받는다.',
            {
              name: z.string().describe('팀원 이름 (list_staff로 확인)'),
              instruction: z.string().describe('그 팀원에게 줄 지시. 담당 폴더 기준으로 씀'),
            },
            async (args) => text(delegation.delegate(args.name, args.instruction)),
          ),
          sdk.tool(
            'collect',
            '지금까지 끝난 결과를 걷는다. 기다리지 않으며, 아직 작업 중인 팀원은 "작업 중"으로 표시된다. 그 팀원 결과는 나중에 다시 collect하면 받을 수 있다.',
            {},
            async () => text(await delegation.collect()),
          ),
          sdk.tool(
            'set_plan',
            '팀 회의록의 "현재 계획"을 통째로 새로 쓴다. 누적이 아니라 교체다 — 지금 유효한 계획 전체를 담아라. 팀원은 여기만 읽는다.',
            { plan: z.string().describe('지금 유효한 계획 전체 (프로젝트 목표 + 역할별 할 일)') },
            async (args) => text(delegation.setPlan(args.plan)),
          ),
          noteTool((t) => delegation.note(t)),
        ]
      : note
        ? [noteTool(note)]
        : [],
  });
}

/** Async iterable the SDK pulls user messages from; `push` feeds it. Keeping the
 *  generator parked on an empty queue is what keeps the session alive. */
function createInputStream(): {
  stream: AsyncIterable<SdkUserMessage>;
  push: (text: string) => void;
} {
  const queue: SdkUserMessage[] = [];
  let notify: (() => void) | null = null;

  const stream = (async function* () {
    for (;;) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = null;
      }
      const next = queue.shift();
      if (next) yield next;
    }
  })();

  return {
    stream,
    push: (text: string) => {
      queue.push({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
      } as SdkUserMessage);
      notify?.();
    },
  };
}
