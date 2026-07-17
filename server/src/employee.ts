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
  /** Waits for every delegation still running (in parallel), then returns all
   *  their answers at once. A delegation held on a clocked-out member is
   *  reported without waiting for it. */
  collect(): Promise<string>;
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
너는 팀장이다. 일을 나눠 맡길 땐 반드시 \`list_staff\`로 팀원을 확인하고 \`delegate\`로 팀원에게 시킨 뒤 \`collect\`로 결과를 모아라. 네 세션 안에서 서브에이전트를 직접 만들지 마라 — 우리 사무실의 팀원들이 실제로 일하는 것이 이 도구의 목적이다. 위임 지시에는 팀원이 헛일을 반복하지 않도록 필요한 맥락(무엇을, 어느 폴더 기준으로, 무엇을 확인할지)을 담아라.`;

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
        ...(delegation ? { mcpServers: { office: officeTools(sdk, delegation) } } : {}),
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

/** The lead's own tools, served in-process. Staff never see these — that is what
 *  keeps delegation from spreading down the org chart. */
function officeTools(sdk: Sdk, delegation: Delegation) {
  const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

  return sdk.createSdkMcpServer({
    name: 'office',
    tools: [
      sdk.tool('list_staff', '팀원 목록과 각자 담당 폴더, 지금 상태를 확인한다.', {}, async () =>
        text(delegation.listStaff()),
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
        '맡긴 일이 끝날 때까지 기다렸다가 결과를 전부 모아서 받는다. 팀원 여러 명에게 delegate한 뒤 한 번만 부르면 된다.',
        {},
        async () => text(await delegation.collect()),
      ),
    ],
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
