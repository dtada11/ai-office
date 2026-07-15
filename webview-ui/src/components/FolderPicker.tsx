import { useCallback, useEffect, useState } from 'react';

import { confirmedCwd, type DirEntry, type DirListing, nextRequestPath } from '../folderPicker.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface FolderPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the confirmed absolute path when "이 폴더 선택" is clicked. */
  onSelect: (path: string) => void;
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

  const load = useCallback((path: string) => {
    setLoading(true);
    fetch(`/api/list-dir?path=${encodeURIComponent(path)}`)
      .then((res) => res.json() as Promise<DirListing>)
      .then(setListing)
      .catch(() => setListing({ path, parent: null, entries: [], error: true }))
      .finally(() => setLoading(false));
  }, []);

  // Reset to the starting screen (drive list / home) every time the picker opens.
  useEffect(() => {
    if (isOpen) load('');
  }, [isOpen, load]);

  if (!isOpen) return null;

  const goTo = (entry: DirEntry) => {
    const next = nextRequestPath(listing, { type: 'drillDown', entry });
    if (next !== null) load(next);
  };

  const goUp = () => {
    const next = nextRequestPath(listing, { type: 'goToParent' });
    if (next !== null) load(next);
  };

  const cwd = confirmedCwd(listing);
  const atTop = !listing || listing.parent === null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="폴더 불러오기" zIndex={60}>
      <div className="flex flex-col gap-4 w-96 px-10 pb-4" data-testid="folder-picker">
        <span
          className="font-mono text-2xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
          title={listing?.path}
          data-testid="folder-picker-path"
        >
          {listing?.path || '내 컴퓨터'}
        </span>

        <Button
          variant={atTop || loading ? 'disabled' : 'default'}
          size="sm"
          disabled={atTop || loading}
          onClick={goUp}
          data-testid="folder-picker-up"
        >
          ↑ 상위로
        </Button>

        <div className="flex flex-col border-2 border-border max-h-64 overflow-y-auto">
          {loading && <span className="text-2xs text-text-muted p-6">불러오는 중…</span>}
          {!loading && listing?.error && (
            <span className="text-2xs text-status-permission p-6" data-testid="folder-picker-error">
              열 수 없음 (존재하지 않거나 권한이 없는 경로입니다)
            </span>
          )}
          {!loading && !listing?.error && listing?.entries.length === 0 && (
            <span className="text-2xs text-text-muted p-6">하위 폴더가 없습니다.</span>
          )}
          {!loading &&
            !listing?.error &&
            listing?.entries.map((entry) => (
              <button
                key={entry.path}
                className="text-left text-xs px-6 py-3 rounded-none cursor-pointer bg-transparent border-none hover:bg-btn-hover"
                onClick={() => goTo(entry)}
                data-testid="folder-picker-entry"
              >
                {entry.name}
              </button>
            ))}
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
