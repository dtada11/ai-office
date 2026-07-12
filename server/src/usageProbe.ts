/**
 * Plan-usage calibration probe.
 *
 * Runs `claude -p /usage`, which prints the subscription's real session/weekly
 * limit percentages. It is a local slash command: no model call, so it costs
 * zero tokens. The parsed percentages are written to the plan-usage snapshot
 * that PlanUsageTracker calibrates against — replacing what the user used to
 * type in by hand, which went stale and skewed the gauges.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SNAPSHOT_PATH = path.join(os.homedir(), '.pixel-agents', 'plan-usage.json');
const PROBE_TIMEOUT_MS = 60 * 1000;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** `Jul 12, 8:59pm` or `Jul 12, 9pm` (server-local timezone) → ISO string.
 *  On the hour, /usage prints no minutes — hence the optional `:MM`. */
function parseResetTime(text: string): string | null {
  const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?(am|pm)$/i.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const day = Number(m[2]);
  const minute = m[4] ? Number(m[4]) : 0;
  let hour = Number(m[3]) % 12;
  if (m[5].toLowerCase() === 'pm') hour += 12;

  const now = new Date();
  const at = new Date(now.getFullYear(), month, day, hour, minute);
  // Year rollover: a reset printed in late December can land in the next year.
  if (at.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
    at.setFullYear(at.getFullYear() + 1);
  }
  return at.toISOString();
}

interface ParsedUsage {
  sessionPercent: number;
  sessionResetsAt: string;
  weeklyAllPercent: number;
  weeklyModelPercent: number;
  weeklyModel: string;
  weeklyResetsAt: string;
}

/** Parse the three percentage lines of `/usage` output. */
export function parseUsageOutput(out: string): ParsedUsage | null {
  const session = /Current session:\s*(\d+)% used\s*·\s*resets ([^(]+)\(/.exec(out);
  const weeklyAll = /Current week \(all models\):\s*(\d+)% used\s*·\s*resets ([^(]+)\(/.exec(out);
  const weeklyModel = /Current week \((?!all models)([^)]+)\):\s*(\d+)% used/.exec(out);
  if (!session || !weeklyAll) return null;

  const sessionResetsAt = parseResetTime(session[2]);
  const weeklyResetsAt = parseResetTime(weeklyAll[2]);
  if (!sessionResetsAt || !weeklyResetsAt) return null;

  return {
    sessionPercent: Number(session[1]),
    sessionResetsAt,
    weeklyAllPercent: Number(weeklyAll[1]),
    weeklyModelPercent: weeklyModel ? Number(weeklyModel[2]) : 0,
    weeklyModel: weeklyModel ? weeklyModel[1].toLowerCase() : '',
    weeklyResetsAt,
  };
}

function runUsageCommand(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '/usage'], { shell: true, windowsHide: true });
    let out = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('/usage 시간 초과'));
    }, PROBE_TIMEOUT_MS);

    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (chunk: string) => (out += chunk));
    proc.stdin.end();
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/**
 * Run /usage and rewrite the calibration snapshot. The `calibration` block is
 * dropped on purpose so the tracker recomputes it against the fresh percentages.
 * Returns true when the snapshot was updated.
 */
export async function refreshPlanSnapshot(): Promise<boolean> {
  let parsed: ParsedUsage | null = null;
  let raw = '';
  // The probe occasionally comes back without the usage block; one retry covers it.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      raw = await runUsageCommand();
      parsed = parseUsageOutput(raw);
    } catch (err) {
      console.warn('[Pixel Agents] /usage probe failed:', err);
      return false;
    }
  }
  if (!parsed) {
    console.warn(
      '[Pixel Agents] could not parse /usage output:',
      JSON.stringify(raw.slice(0, 300)),
    );
    return false;
  }

  const snapshot = { capturedAt: new Date().toISOString(), ...parsed };
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[Pixel Agents] failed to write plan-usage snapshot:', err);
    return false;
  }
  console.log(
    `[Pixel Agents] plan usage calibrated from /usage: session ${parsed.sessionPercent}%, weekly ${parsed.weeklyAllPercent}%`,
  );
  return true;
}
