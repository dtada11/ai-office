/**
 * Employee adapter boundary.
 *
 * An employee is one AI worker with its own session, folder and character.
 * Everything provider-specific (today: the Claude Agent SDK) lives behind the
 * `Employee` interface, and the events crossing this boundary are OUR types —
 * no SDK type leaves this file. Swapping in another provider later means
 * writing a second implementation, not touching the office.
 */

import { getContextLimit } from './claudeSettings.js';

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
  /** A tool the employee is using, by name. */
  | { kind: 'tool'; text: string }
  /** A turn finished. `text` is set only on error. */
  | { kind: 'result'; text: string }
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

export interface Employee {
  readonly name: string;
  readonly cwd: string;
  /** Set once the session reports it; the office keys its character off this. */
  readonly sessionId: string;
  start(model?: string): Promise<void>;
  send(text: string): void;
  setModel(model: string): Promise<void>;
  stop(): void;
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
  ) {}

  async start(model?: string): Promise<void> {
    const input = createInputStream();
    const { query } = await importSdk();

    this.q = query({
      prompt: input.stream,
      options: {
        cwd: this.cwd,
        model,
        canUseTool: async (toolName, toolInput, options) => {
          const allowed = await this.host.askPermission({
            requestId: options.requestId,
            toolName,
            title: options.title ?? '',
            input: JSON.stringify(toolInput).slice(0, 500),
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
        const b = block as { type: string; text?: string; name?: string };
        if (b.type === 'text' && b.text) {
          this.host.onEvent({ kind: 'text', text: b.text });
        } else if (b.type === 'tool_use' && b.name) {
          this.host.onEvent({ kind: 'tool', text: b.name });
        }
      }
      return;
    }

    if (type === 'result') {
      const result = msg as { is_error?: boolean; result?: string };
      this.host.onEvent({
        kind: 'result',
        text: result.is_error ? `오류: ${result.result ?? '알 수 없음'}` : '',
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
