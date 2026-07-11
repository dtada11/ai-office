import { useState } from 'react';

import {
  FUEL_COLOR_CRITICAL,
  FUEL_COLOR_DANGER,
  FUEL_COLOR_OK,
  FUEL_COLOR_WARN,
  TOKEN_CRITICAL_THRESHOLD,
  TOKEN_DANGER_THRESHOLD,
  TOKEN_WARN_THRESHOLD,
} from '../constants.js';
import type { AgentTokenInfo, PlanUsageInfo } from '../hooks/useExtensionMessages.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';

/** Top-right context-token gauge with a model dropdown.
 *  Shows the selected (or first) agent's latest request context size against
 *  the model's context window. The dropdown writes the chosen model into
 *  ~/.claude/settings.json — Claude Code applies it to NEW sessions only. */

const DEFAULT_CONTEXT_LIMIT = 200_000;

const MODEL_OPTIONS = [
  { id: 'claude-fable-5[1m]', label: 'Fable 5 (1M)' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

function displayModel(id?: string): string {
  if (!id) return '감지 중…';
  const found = MODEL_OPTIONS.find((m) => m.id === id || m.id.replace(/\[1m\]$/, '') === id);
  if (found) return found.label;
  return id
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-/g, ' ');
}

function fuelColor(ratio: number): string {
  if (ratio >= TOKEN_CRITICAL_THRESHOLD) return FUEL_COLOR_CRITICAL;
  if (ratio >= TOKEN_DANGER_THRESHOLD) return FUEL_COLOR_DANGER;
  if (ratio >= TOKEN_WARN_THRESHOLD) return FUEL_COLOR_WARN;
  return FUEL_COLOR_OK;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** HH:MM local time of an ISO timestamp, for reset labels. */
function resetLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

interface PlanBarProps {
  label: string;
  percent: number;
  suffix?: string;
}

function PlanBar({ label, percent, suffix }: PlanBarProps) {
  const ratio = Math.min(1, percent / 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-8">
        <span className="text-xs text-text-muted whitespace-nowrap">{label}</span>
        <span className="text-xs whitespace-nowrap">
          {percent.toFixed(percent >= 10 ? 0 : 1)}%{suffix ? ` · ${suffix}` : ''}
        </span>
      </div>
      <div className="border-2 border-border rounded-none h-8 overflow-hidden">
        <div
          className="h-full"
          style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: fuelColor(ratio) }}
          data-testid={`plan-gauge-bar-${label}`}
        />
      </div>
    </div>
  );
}

interface TokenGaugeProps {
  agents: number[];
  selectedAgent: number | null;
  agentTokenInfo: Record<number, AgentTokenInfo>;
  planUsage: PlanUsageInfo | null;
}

export function TokenGauge({ agents, selectedAgent, agentTokenInfo, planUsage }: TokenGaugeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);

  const agentId = selectedAgent ?? agents[0];
  // Plan gauges are account-wide, so keep the panel visible even with no agents.
  if (agentId === undefined && !planUsage) return null;
  const info = agentId !== undefined ? agentTokenInfo[agentId] : undefined;

  const used = info?.contextTokens ?? 0;
  const limit = info?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  const remaining = Math.max(0, limit - used);
  const ratio = Math.min(1, used / limit);

  const handleSelect = (id: string, label: string) => {
    transport.send({ type: 'setClaudeModel', model: id });
    setPendingModel(label);
    setIsOpen(false);
  };

  return (
    <div className="absolute top-10 right-10 z-20 pixel-panel p-8 flex flex-col gap-4 min-w-128">
      <div className="relative flex items-center justify-between gap-8">
        <span className="text-sm text-text-muted whitespace-nowrap">모델</span>
        <Button variant="default" size="sm" onClick={() => setIsOpen((v) => !v)}>
          {displayModel(info?.model)} ▾
        </Button>
        {isOpen && (
          <div className="absolute top-full right-0 pt-4 z-30">
            <div className="bg-bg border-2 border-border rounded-none shadow-pixel p-4">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleSelect(m.id, m.label)}
                  className="block w-full text-left py-2 px-12 bg-transparent border-none rounded-none cursor-pointer whitespace-nowrap hover:bg-btn-bg"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {pendingModel && (
        <span className="text-xs text-text-muted whitespace-nowrap">
          → {pendingModel} 저장됨 (새 세션부터 적용)
        </span>
      )}
      <div className="border-2 border-border rounded-none h-10 overflow-hidden">
        <div
          className="h-full"
          style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: fuelColor(ratio) }}
          data-testid="token-gauge-bar"
        />
      </div>
      <span className="text-xs whitespace-nowrap">
        컨텍스트 {fmt(used)} 사용 · {fmt(remaining)} 남음 ({fmt(limit)} 중)
      </span>
      {planUsage && (
        <div className="flex flex-col gap-4 border-t-2 border-border pt-4 mt-2">
          <PlanBar
            label="세션"
            percent={planUsage.sessionPercent}
            suffix={
              planUsage.sessionResetsAt
                ? `${resetLabel(planUsage.sessionResetsAt)} 리셋`
                : undefined
            }
          />
          <PlanBar label="주간 전체" percent={planUsage.weeklyAllPercent} />
          <PlanBar label="주간 Fable" percent={planUsage.weeklyModelPercent} />
          {!planUsage.calibrated && (
            <span className="text-xs text-text-muted whitespace-nowrap">
              미보정 추정치 (~/.pixel-agents/plan-usage.json 스냅샷 필요)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
