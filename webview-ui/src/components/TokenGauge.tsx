import { useEffect, useState } from 'react';

import {
  FUEL_COLOR_CRITICAL,
  FUEL_COLOR_DANGER,
  FUEL_COLOR_OK,
  FUEL_COLOR_WARN,
  TOKEN_CRITICAL_THRESHOLD,
  TOKEN_DANGER_THRESHOLD,
  TOKEN_WARN_THRESHOLD,
} from '../constants.js';
import type { AgentTokenInfo, EmployeeInfo, PlanUsageInfo } from '../hooks/useExtensionMessages.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';

/** Top-right context-token gauge. Shows the selected (or first) agent's latest
 *  request context size against the model's context window, plus the plan gauges.
 *  Model choice does not live here: an employee is put on their model from their
 *  own chat window, one at a time. */

const DEFAULT_CONTEXT_LIMIT = 200_000;

function fuelColor(ratio: number): string {
  if (ratio >= TOKEN_CRITICAL_THRESHOLD) return FUEL_COLOR_CRITICAL;
  if (ratio >= TOKEN_DANGER_THRESHOLD) return FUEL_COLOR_DANGER;
  if (ratio >= TOKEN_WARN_THRESHOLD) return FUEL_COLOR_WARN;
  return FUEL_COLOR_OK;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  // One decimal below 100k, else a turn that adds a few hundred tokens rounds
  // to the same number and the gauge looks stuck.
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
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
  /** The staff; the gauge shows the selected employee's context. */
  employees: EmployeeInfo[];
}

export function TokenGauge({
  agents,
  selectedAgent,
  agentTokenInfo,
  planUsage,
  employees,
}: TokenGaugeProps) {
  const [refreshing, setRefreshing] = useState(false);

  // The server answers with a fresh planUsage broadcast; clear the spinner then.
  useEffect(() => {
    setRefreshing(false);
  }, [planUsage]);

  const refreshPlanUsage = () => {
    setRefreshing(true);
    transport.send({ type: 'refreshPlanUsage' });
  };

  const agentId = selectedAgent ?? agents[0];
  // Plan gauges are account-wide, so keep the panel visible even with no agents.
  if (agentId === undefined && !planUsage) return null;
  const info = agentId !== undefined ? agentTokenInfo[agentId] : undefined;

  // An employee reports its own usage, which beats parsing transcripts — and it
  // is the only source when the employee works outside the scanned folder.
  const employee = employees.find((e) => e.agentId === agentId);
  const used = employee?.contextTokens || (info?.contextTokens ?? 0);
  const limit =
    (employee?.contextTokens ? employee.contextLimit : info?.contextLimit) || DEFAULT_CONTEXT_LIMIT;
  const remaining = Math.max(0, limit - used);
  const ratio = Math.min(1, used / limit);

  return (
    <div className="absolute top-10 right-10 z-20 pixel-panel p-8 flex flex-col gap-4 min-w-128">
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
      {/* A plan percentage is a subscription's idea. This employee is billed per
          token, so what they have run up is the only number that means anything. */}
      {employee?.authMode === 'apiKey' ? (
        <div className="flex flex-col gap-2 border-t-2 border-border pt-4 mt-2">
          <div className="flex items-center justify-between gap-8">
            <span className="text-xs text-text-muted whitespace-nowrap">비용 (누적)</span>
            <span className="text-xs whitespace-nowrap" data-testid="employee-cost">
              ${(employee.costUsd ?? 0).toFixed(4)}
            </span>
          </div>
          <span className="text-xs text-text-muted">API 키 · 플랜 한도 없음</span>
        </div>
      ) : (
        planUsage && (
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
            <div className="flex items-center justify-between gap-8">
              {!planUsage.calibrated && (
                <span className="text-xs text-text-muted whitespace-nowrap">미보정 추정치</span>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={refreshPlanUsage}
                title="/usage로 실제 사용률 다시 맞추기 (토큰 소모 없음)"
                data-testid="plan-usage-refresh"
              >
                {refreshing ? '⋯' : '⟳'}
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
