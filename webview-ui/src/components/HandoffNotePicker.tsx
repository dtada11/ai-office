import type { HandoffNotesInfo } from '../hooks/useExtensionMessages.js';

interface HandoffNotePickerProps {
  /** The hire form's cwd draft — compared against handoffNotes.cwd so a stale
   *  answer for a folder the user has since changed away from never shows. */
  cwd: string;
  handoffNotes: HandoffNotesInfo | null;
  /** Selected folder key, or '' for "없음 (새로 시작)". */
  value: string;
  onChange: (key: string) => void;
  /** Radio `name` — kept unique per caller so this can appear twice on screen
   *  (e.g. StaffPanel's hire tab and the onboarding wizard) without one
   *  picker's native radio grouping bleeding into the other's. */
  groupName: string;
}

/** Radio list of "resume from" choices for a hire form's cwd — populated once
 *  listHandoffNotes has answered for that exact folder (see the cwd check
 *  below). Hidden entirely when there is nothing to resume from, so a
 *  brand-new folder's hire form looks no different than before this feature
 *  existed. */
export function HandoffNotePicker({
  cwd,
  handoffNotes,
  value,
  onChange,
  groupName,
}: HandoffNotePickerProps) {
  if (handoffNotes?.cwd !== cwd.trim() || handoffNotes.notes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-2 border-border p-4" data-testid="handoff-picker">
      <span className="text-2xs text-text-muted">이 폴더에 남은 인수인계 노트</span>
      <label className="flex items-center gap-4 text-xs cursor-pointer">
        <input type="radio" name={groupName} checked={value === ''} onChange={() => onChange('')} />
        없음 (새로 시작)
      </label>
      {handoffNotes.notes.map((n) => (
        <label key={n.key} className="flex items-center gap-4 text-xs cursor-pointer">
          <input
            type="radio"
            name={groupName}
            checked={value === n.key}
            onChange={() => onChange(n.key)}
          />
          {n.employee} · {n.savedAt.slice(0, 10)}
        </label>
      ))}
    </div>
  );
}
