/**
 * Plan usage gauges: estimate how much of the Claude subscription's
 * session / weekly limits is consumed, from local transcript JSONL files.
 *
 * Method (mirrors the PlanUsage schema docs in core/asyncapi.yaml):
 *  - Weighted token aggregation over ~/.claude/projects JSONL usage records
 *    (input x1, cache creation x1.25, cache read x0.1, output x5).
 *  - Calibrated against a user snapshot (~/.pixel-agents/plan-usage.json)
 *    of the real percentages from Claude's usage UI. The percent-per-weighted-token
 *    rate derived at the snapshot moment is persisted back into the file so it
 *    survives restarts after old transcripts age out.
 *  - Gauge windows: session = 5h cycle, weekly = 7d cycle, anchored at the
 *    reset times recorded in the snapshot. Only tokens inside the current
 *    window count, so every gauge naturally drops to 0 at each reset.
 *
 * Unlike the per-agent context gauge, sidechain (sub-agent) records DO count:
 * they consume plan quota even though they don't grow the main context.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PlanUsage } from '../../core/src/messages.js';

const SESSION_PERIOD_MS = 5 * 60 * 60 * 1000;
const WEEK_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

const WEIGHT_INPUT = 1;
const WEIGHT_CACHE_CREATE = 1.25;
const WEIGHT_CACHE_READ = 0.1;
const WEIGHT_OUTPUT = 5;

/** Rough caps used only when no snapshot exists (calibrated=false). */
const FALLBACK_CAP_SESSION = 60_000_000;
const FALLBACK_CAP_WEEKLY_ALL = 1_500_000_000;
const FALLBACK_CAP_WEEKLY_MODEL = 300_000_000;

/** Keep this many recently-seen message ids per file for usage dedupe. */
const DEDUPE_CAP = 500;

const SNAPSHOT_PATH = path.join(os.homedir(), '.pixel-agents', 'plan-usage.json');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

interface Snapshot {
  capturedAt: string;
  sessionPercent: number;
  sessionResetsAt: string;
  weeklyAllPercent: number;
  weeklyModelPercent: number;
  /** Substring matched against message.model for the per-model gauge. */
  weeklyModel?: string;
  weeklyResetsAt: string;
  /** Written back by the server after first successful calibration. */
  calibration?: {
    kSession?: number;
    kWeeklyAll?: number;
    kWeeklyModel?: number;
    computedAt: string;
  };
}

interface UsageEvent {
  t: number;
  w: number;
  model: string;
}

interface FileState {
  offset: number;
  recentIds: Set<string>;
  idQueue: string[];
}

/** Latest computed gauge message, for handleWebviewReady. */
let latestPlanUsage: PlanUsage | null = null;

export function getLatestPlanUsage(): PlanUsage | null {
  return latestPlanUsage;
}

/** Start of the cycle containing `now`, for a cycle anchored at `anchor`. */
function windowStart(now: number, anchor: number, period: number): number {
  return anchor + Math.floor((now - anchor) / period) * period;
}

/** Next reset boundary strictly after `now`. */
function nextReset(now: number, anchor: number, period: number): number {
  return windowStart(now, anchor, period) + period;
}

export class PlanUsageTracker {
  private events: UsageEvent[] = [];
  private fileStates = new Map<string, FileState>();
  private snapshot: Snapshot | null = null;
  private calibrated = false;
  private sessionAnchor = 0;
  private weeklyAnchor = 0;

  constructor() {
    this.loadSnapshot();
  }

  /** Re-read the snapshot after usageProbe rewrote it, so the next tick
   *  recalibrates against the fresh percentages. Clearing the flag is what
   *  makes calibrate() run again — without it the new snapshot is ignored. */
  reloadSnapshot(): void {
    this.loadSnapshot();
    this.calibrated = false;
  }

  private loadSnapshot(): void {
    try {
      const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf-8');
      this.snapshot = JSON.parse(raw) as Snapshot;
      this.sessionAnchor = Date.parse(this.snapshot.sessionResetsAt);
      this.weeklyAnchor = Date.parse(this.snapshot.weeklyResetsAt);
      if (Number.isNaN(this.sessionAnchor) || Number.isNaN(this.weeklyAnchor)) {
        console.warn('[Pixel Agents] plan-usage.json has invalid reset timestamps; ignoring');
        this.snapshot = null;
      }
    } catch {
      this.snapshot = null;
    }
    if (!this.snapshot) {
      // No snapshot: fall back to arbitrary anchors (top of the current hour /
      // Saturday 13:00 KST) so windows still cycle sensibly.
      const now = Date.now();
      this.sessionAnchor = now - (now % (60 * 60 * 1000));
      this.weeklyAnchor = Date.parse('2026-07-11T13:00:00+09:00');
    }
  }

  /** Incrementally scan JSONL files, recompute gauges, cache + return the message. */
  async tick(): Promise<PlanUsage> {
    await this.scan();
    this.calibrate();
    this.prune();
    const msg = this.compute();
    latestPlanUsage = msg;
    return msg;
  }

  private async scan(): Promise<void> {
    const cutoff = Date.now() - WEEK_PERIOD_MS - 24 * 60 * 60 * 1000;
    let dirs: string[] = [];
    try {
      dirs = (await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => path.join(PROJECTS_DIR, d.name));
    } catch {
      return; // no transcripts at all
    }
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = await fs.promises.readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue;
        const filePath = path.join(dir, name);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.mtimeMs < cutoff) continue;
          await this.readFileIncremental(filePath, stat.size);
        } catch {
          // File vanished mid-scan or unreadable; skip.
        }
      }
    }
  }

  private async readFileIncremental(filePath: string, size: number): Promise<void> {
    let state = this.fileStates.get(filePath);
    if (!state) {
      state = { offset: 0, recentIds: new Set(), idQueue: [] };
      this.fileStates.set(filePath, state);
    }
    if (size < state.offset) state.offset = 0; // truncated/rotated: reread
    if (size === state.offset) return;

    const fd = await fs.promises.open(filePath, 'r');
    try {
      const length = size - state.offset;
      const buf = Buffer.alloc(length);
      await fd.read(buf, 0, length, state.offset);
      const lastNewline = buf.lastIndexOf(0x0a);
      if (lastNewline === -1) return; // no complete line yet
      const chunk = buf.subarray(0, lastNewline + 1).toString('utf-8');
      state.offset += lastNewline + 1;
      for (const line of chunk.split('\n')) {
        if (line.includes('"usage"')) this.parseLine(line, state);
      }
    } finally {
      await fd.close();
    }
  }

  private parseLine(line: string, state: FileState): void {
    try {
      const record = JSON.parse(line) as {
        timestamp?: string;
        message?: {
          id?: string;
          model?: string;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
        };
      };
      const usage = record.message?.usage;
      if (!usage || !record.timestamp) return;
      const model = record.message?.model ?? '';
      if (model === '<synthetic>') return;

      // One assistant message with N parallel tool_use blocks repeats the same
      // usage in N records — dedupe by message.id (bounded per-file set).
      const messageId = record.message?.id;
      if (typeof messageId === 'string') {
        if (state.recentIds.has(messageId)) return;
        state.recentIds.add(messageId);
        state.idQueue.push(messageId);
        if (state.idQueue.length > DEDUPE_CAP) {
          const evicted = state.idQueue.shift();
          if (evicted) state.recentIds.delete(evicted);
        }
      }

      const w =
        (usage.input_tokens ?? 0) * WEIGHT_INPUT +
        (usage.cache_creation_input_tokens ?? 0) * WEIGHT_CACHE_CREATE +
        (usage.cache_read_input_tokens ?? 0) * WEIGHT_CACHE_READ +
        (usage.output_tokens ?? 0) * WEIGHT_OUTPUT;
      if (w <= 0) return;
      const t = Date.parse(record.timestamp);
      if (Number.isNaN(t)) return;
      this.events.push({ t, w, model });
    } catch {
      // Malformed line; skip.
    }
  }

  /** Derive percent-per-weighted-token rates from the snapshot moment, once. */
  private calibrate(): void {
    if (!this.snapshot || this.calibrated) return;
    const cal = this.snapshot.calibration ?? { computedAt: new Date().toISOString() };
    const capturedAt = Date.parse(this.snapshot.capturedAt);
    if (!Number.isNaN(capturedAt)) {
      const modelFilter = this.snapshot.weeklyModel ?? 'fable';
      if (cal.kSession === undefined) {
        const start = windowStart(capturedAt, this.sessionAnchor, SESSION_PERIOD_MS);
        const w = this.sum(start, capturedAt);
        if (w > 0) cal.kSession = this.snapshot.sessionPercent / w;
      }
      if (cal.kWeeklyAll === undefined) {
        const start = windowStart(capturedAt, this.weeklyAnchor, WEEK_PERIOD_MS);
        const w = this.sum(start, capturedAt);
        if (w > 0) cal.kWeeklyAll = this.snapshot.weeklyAllPercent / w;
      }
      if (cal.kWeeklyModel === undefined) {
        const start = windowStart(capturedAt, this.weeklyAnchor, WEEK_PERIOD_MS);
        const w = this.sum(start, capturedAt, modelFilter);
        if (w > 0) cal.kWeeklyModel = this.snapshot.weeklyModelPercent / w;
      }
    }
    this.snapshot.calibration = cal;
    this.calibrated = true;
    try {
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(this.snapshot, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[Pixel Agents] failed to persist plan-usage calibration:', err);
    }
  }

  /** Drop events that left the weekly window (with margin for calibration reuse). */
  private prune(): void {
    const cutoff = windowStart(Date.now(), this.weeklyAnchor, WEEK_PERIOD_MS) - 60 * 60 * 1000;
    if (this.events.length > 0 && this.events[0].t < cutoff) {
      this.events = this.events.filter((e) => e.t >= cutoff);
    }
  }

  private sum(from: number, to: number, modelFilter?: string): number {
    let total = 0;
    for (const e of this.events) {
      if (e.t < from || e.t > to) continue;
      if (modelFilter && !e.model.includes(modelFilter)) continue;
      total += e.w;
    }
    return total;
  }

  private compute(): PlanUsage {
    const now = Date.now();
    const cal = this.snapshot?.calibration;
    const modelFilter = this.snapshot?.weeklyModel ?? 'fable';

    const sessionStart = windowStart(now, this.sessionAnchor, SESSION_PERIOD_MS);
    const weeklyStart = windowStart(now, this.weeklyAnchor, WEEK_PERIOD_MS);
    const wSession = this.sum(sessionStart, now);
    const wWeeklyAll = this.sum(weeklyStart, now);
    const wWeeklyModel = this.sum(weeklyStart, now, modelFilter);

    const pct = (w: number, k: number | undefined, fallbackCap: number): number => {
      const raw = k !== undefined ? w * k : (w / fallbackCap) * 100;
      return Math.min(100, Math.round(raw * 10) / 10);
    };

    return {
      type: 'planUsage',
      sessionPercent: pct(wSession, cal?.kSession, FALLBACK_CAP_SESSION),
      sessionResetsAt: new Date(
        nextReset(now, this.sessionAnchor, SESSION_PERIOD_MS),
      ).toISOString(),
      weeklyAllPercent: pct(wWeeklyAll, cal?.kWeeklyAll, FALLBACK_CAP_WEEKLY_ALL),
      weeklyModelPercent: pct(wWeeklyModel, cal?.kWeeklyModel, FALLBACK_CAP_WEEKLY_MODEL),
      weeklyResetsAt: new Date(nextReset(now, this.weeklyAnchor, WEEK_PERIOD_MS)).toISOString(),
      calibrated:
        cal?.kSession !== undefined &&
        cal?.kWeeklyAll !== undefined &&
        cal?.kWeeklyModel !== undefined,
    };
  }
}
