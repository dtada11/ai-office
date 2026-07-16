import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import {
  collapseBreadcrumb,
  confirmedCwd,
  type DirEntry,
  type DirListing,
  fallbackAfterRestore,
  LAST_PATH_STORAGE_KEY,
  nextRequestPath,
  pathSegments,
  startingPath,
} from '../folderPicker.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

/** localStorage read/write are wrapped in try/catch -- some webview hosts run
 *  with storage disabled or restricted, and "resume where I left off" is a
 *  nicety worth losing quietly, not a reason to break the picker. */
function readLastPath(): string | null {
  try {
    return window.localStorage.getItem(LAST_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistLastPath(path: string): void {
  try {
    window.localStorage.setItem(LAST_PATH_STORAGE_KEY, path);
  } catch {
    // Ignore -- see readLastPath.
  }
}

interface FolderPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the confirmed absolute path when "이 폴더 선택" is clicked. */
  onSelect: (path: string) => void;
}

/** Folder outline built from straight lines only (no diagonals/curves) to
 *  match the app's blocky pixel-art tone -- just enough shape to read as
 *  "this is a folder" next to an entry name, without competing with it. */
function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0 text-text-muted"
      aria-hidden="true"
    >
      <path d="M2 3 H7 V5 H14 V13 H2 Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Server-driven folder browser for the hire form's cwd field. The browser's
 *  own folder picker (`showDirectoryPicker`) hands back a directory handle,
 *  not an absolute path -- useless here, since an employee's session cwd is
 *  a real path the server has to `cd` into. So instead of that, this walks
 *  the filesystem through the read-only GET /api/list-dir endpoint: the
 *  webview only renders what the server reports, it never resolves paths
 *  itself. Text entry in the hire form still works alongside this. */
export function FolderPicker({ isOpen, onClose, onSelect }: FolderPickerProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(false);
  // Keyboard-driven highlight within the current entry list. -1 means "none
  // yet" -- the first arrow press picks a starting entry (see moveFocus).
  // Independent of real DOM focus: Tab still reaches the picker's buttons
  // normally, this is just an accelerator for arrowing through the list.
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const entryRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Monotonic counter identifying the most recently *started* request. A
  // slow response for a folder the user has since navigated away from
  // (goTo/goUp/breadcrumb click firing before an earlier fetch returns)
  // would otherwise clobber whatever the latest request already rendered.
  const latestRequestIdRef = useRef(0);

  // `isRestore` marks an attempt to resume the saved last-opened path, as
  // opposed to an ordinary in-picker navigation. Only that kind of attempt
  // triggers the "path is gone, bounce back to the starting screen" fallback.
  const load = useCallback((path: string, isRestore = false): Promise<void> => {
    const requestId = ++latestRequestIdRef.current;
    setLoading(true);
    return fetch(`/api/list-dir?path=${encodeURIComponent(path)}`)
      .then((res) => res.json() as Promise<DirListing>)
      .catch(() => ({ path, parent: null, entries: [], error: true }) as DirListing)
      .then((result) => {
        const fallback = fallbackAfterRestore(result, isRestore);
        if (fallback !== null) return load(fallback);

        // A newer request has started since this one — drop this response
        // instead of applying it, so only the latest navigation ever reaches
        // the screen (and the confirmed-cwd persisted from it).
        if (requestId !== latestRequestIdRef.current) return undefined;

        setListing(result);
        setFocusedIndex(-1);
        const toPersist = confirmedCwd(result);
        if (toPersist !== null) persistLastPath(toPersist);
        return undefined;
      })
      .finally(() => {
        if (requestId === latestRequestIdRef.current) setLoading(false);
      });
  }, []);

  // On open, resume the last-visited folder instead of the drive list --
  // falling back to the starting screen on first use or a stale/dead path.
  useEffect(() => {
    if (isOpen) load(startingPath(readLastPath()), true);
  }, [isOpen, load]);

  const goTo = useCallback(
    (entry: DirEntry) => {
      const next = nextRequestPath(listing, { type: 'drillDown', entry });
      if (next !== null) load(next);
    },
    [listing, load],
  );

  const goUp = useCallback(() => {
    const next = nextRequestPath(listing, { type: 'goToParent' });
    if (next !== null) load(next);
  }, [listing, load]);

  const moveFocus = useCallback(
    (delta: number) => {
      const count = listing?.entries.length ?? 0;
      if (count === 0) return;
      setFocusedIndex((prev) => {
        if (prev < 0) return delta > 0 ? 0 : count - 1;
        return Math.min(count - 1, Math.max(0, prev + delta));
      });
    },
    [listing],
  );

  const cwd = confirmedCwd(listing);
  const atTop = !listing || listing.parent === null;

  // ↑↓ move the highlight, Enter drills into the highlighted entry, Backspace
  // / ← go up a level, Esc closes (Modal itself doesn't handle Esc).
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(-1);
      } else if (e.key === 'Enter') {
        const entry = focusedIndex >= 0 ? listing?.entries[focusedIndex] : undefined;
        if (entry) {
          e.preventDefault();
          goTo(entry);
        }
      } else if (e.key === 'Backspace' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!atTop && !loading) goUp();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, listing, focusedIndex, atTop, loading, moveFocus, goTo, goUp, onClose]);

  // Keep the highlighted entry in view as it moves past the scrollable list's edges.
  useEffect(() => {
    if (focusedIndex < 0) return;
    entryRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  if (!isOpen) return null;

  // Root-to-leaf crumbs for the current path, collapsed so a deep path
  // still reads as "root … parent / here" instead of an unbounded row.
  const breadcrumb = listing?.path ? collapseBreadcrumb(pathSegments(listing.path)) : [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="폴더 불러오기" zIndex={60}>
      <div className="flex flex-col gap-4 w-[400px] px-10 pb-4" data-testid="folder-picker">
        <div
          className="flex items-center gap-2 min-w-0 font-mono text-2xs"
          data-testid="folder-picker-path"
        >
          {breadcrumb.length === 0 ? (
            <span className="text-text-muted">내 컴퓨터</span>
          ) : (
            breadcrumb.map((seg, i) => {
              const isLast = i === breadcrumb.length - 1;
              const key = 'ellipsis' in seg ? `ellipsis-${i}` : seg.path;
              return (
                <Fragment key={key}>
                  {i > 0 && (
                    <span className="shrink-0 text-text-muted" aria-hidden="true">
                      ›
                    </span>
                  )}
                  {'ellipsis' in seg ? (
                    <span className="shrink-0 text-text-muted">…</span>
                  ) : isLast ? (
                    // Current location: not a link, just where you are.
                    <span
                      className="min-w-0 max-w-[14ch] truncate text-text"
                      title={seg.path}
                      data-testid="folder-picker-breadcrumb-current"
                    >
                      {seg.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 max-w-[8ch] shrink truncate cursor-pointer border-none bg-transparent p-0 text-text-muted hover:text-text disabled:cursor-default disabled:hover:text-text-muted"
                      onClick={() => load(seg.path)}
                      disabled={loading}
                      title={seg.path}
                      data-testid="folder-picker-breadcrumb-segment"
                    >
                      {seg.label}
                    </button>
                  )}
                </Fragment>
              );
            })
          )}
        </div>

        <Button
          variant={atTop || loading ? 'disabled' : 'default'}
          size="sm"
          disabled={atTop || loading}
          onClick={goUp}
          data-testid="folder-picker-up"
        >
          ↑ 상위로
        </Button>

        {/* Stated once, up front, rather than only after someone hits an empty
         *  folder and wonders where their files went -- this picker only ever
         *  lists subfolders (it's choosing a cwd, not a file). */}
        <span className="text-2xs text-text-muted" data-testid="folder-picker-hint">
          폴더만 보여드려요 · 파일은 표시하지 않아요
        </span>

        {/* max-h는 px다 — index.css가 Tailwind --spacing을 1px로 재정의한다(픽셀아트 프로젝트).
            표준 Tailwind 감각으로 max-h-64를 쓰면 256px이 아니라 64px(≈행 2개)이 된다. */}
        <div className="flex flex-col border-2 border-border max-h-256 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-4 p-6" data-testid="folder-picker-loading">
              <span className="w-6 h-6 rounded-full shrink-0 bg-status-active pixel-pulse" />
              <span className="text-2xs text-text-muted">불러오는 중…</span>
            </div>
          )}
          {!loading && listing?.error && (
            <div className="flex items-center gap-4 p-6" data-testid="folder-picker-error">
              <span className="w-6 h-6 rounded-full shrink-0 bg-status-permission" />
              <span className="text-2xs text-status-permission">
                열 수 없음 (존재하지 않거나 권한이 없는 경로입니다)
              </span>
            </div>
          )}
          {!loading && !listing?.error && listing?.entries.length === 0 && (
            <div className="flex items-start gap-4 p-6" data-testid="folder-picker-empty">
              <span className="w-6 h-6 rounded-full shrink-0 border-2 border-border mt-2" />
              <span className="text-2xs text-text-muted">
                하위 폴더가 없어요. 아래 이 폴더 선택 버튼을 누르면 지금 여기를 담당 폴더로 지정할
                수 있어요.
              </span>
            </div>
          )}
          {!loading &&
            !listing?.error &&
            listing?.entries.map((entry, i) => (
              <button
                key={entry.path}
                ref={(el) => {
                  entryRefs.current[i] = el;
                }}
                className={`flex items-center gap-4 text-left text-xs px-6 py-3 rounded-none cursor-pointer bg-transparent border-none hover:bg-btn-hover ${i === focusedIndex ? 'bg-btn-hover' : ''}`}
                onClick={() => goTo(entry)}
                data-testid="folder-picker-entry"
                data-focused={i === focusedIndex || undefined}
              >
                <FolderIcon />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>
            ))}
        </div>

        <div className="flex flex-col gap-2" data-testid="folder-picker-selection">
          <span className="text-2xs text-text-muted">선택할 폴더</span>
          <span
            className={`font-mono text-xs truncate ${cwd === null ? 'text-text-muted' : 'text-text'}`}
            title={cwd ?? undefined}
            data-testid="folder-picker-selection-path"
          >
            {cwd ?? '폴더를 선택하세요'}
          </span>
        </div>

        <Button
          variant={cwd === null ? 'disabled' : 'accent'}
          size="sm"
          disabled={cwd === null}
          onClick={() => {
            if (cwd !== null) {
              onSelect(cwd);
              onClose();
            }
          }}
          data-testid="folder-picker-confirm"
        >
          이 폴더 선택
        </Button>
      </div>
    </Modal>
  );
}
