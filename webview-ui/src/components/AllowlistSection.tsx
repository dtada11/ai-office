import type { AllowlistEmployee, AllowlistEntry } from '../../../core/src/messages.js';
import { entryDetail } from './allowlistFormat.js';
import { Button } from './ui/Button.js';

interface AllowlistSectionProps {
  /** Everyone on the roster, as the server listed them. */
  employees: AllowlistEmployee[];
  onRemove: (agentId: number, entry: AllowlistEntry) => void;
}

/**
 * "무엇을 자동 허용해뒀나" — every employee's standing permissions, one row each,
 * with the x that revokes one.
 *
 * Takes the list and the remove callback as props rather than reaching for the
 * transport: that keeps it renderable in a plain test, and the panel above it
 * already owns the request/refresh cycle.
 */
export function AllowlistSection({ employees, onRemove }: AllowlistSectionProps) {
  return (
    <div className="flex flex-col gap-4 border-t-2 border-border pt-6 mt-4 px-10 pb-4">
      <span className="text-xs">자동 허용</span>
      <span className="text-xs text-text-muted">
        직원이 물어보지 않고 바로 실행하는 항목입니다. x 를 누르면 다음부터 다시 물어봅니다.
      </span>

      {employees.length === 0 ? (
        <span className="text-xs text-text-muted">직원이 없습니다</span>
      ) : (
        employees.map((employee) => (
          <div key={employee.agentId} className="flex flex-col gap-2">
            <span className="text-xs">{employee.name}</span>
            {employee.allow.length === 0 ? (
              // Named but empty, never omitted: a missing employee reads as "not
              // hired", which is a different answer to "what have I allowed?".
              <span className="text-xs text-text-muted pl-6">자동 허용한 항목이 없습니다</span>
            ) : (
              employee.allow.map((entry) => (
                <div
                  key={`${entry.tool}|${entry.match}|${entry.value}`}
                  className="flex items-start justify-between gap-8 pl-6"
                >
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <span className="text-xs overflow-hidden text-ellipsis whitespace-nowrap">
                      <span className="text-text-muted">{entry.tool}</span> {entry.value}
                    </span>
                    <span className="text-xs text-text-muted">
                      {entryDetail(entry.match, entry.addedAt)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(employee.agentId, entry)}
                    className="shrink-0"
                    data-testid="remove-allowlist-entry"
                  >
                    x
                  </Button>
                </div>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}
