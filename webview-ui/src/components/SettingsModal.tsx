import { useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  externalAssetDirectories: string[];
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  externalAssetDirectories,
  watchAllSessions,
  onToggleWatchAllSessions,
  hooksEnabled,
  onToggleHooksEnabled,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="설정">
      <MenuItem
        onClick={() => {
          transport.send({ type: 'openSessionsFolder' });
          onClose();
        }}
      >
        세션 폴더 열기
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'exportLayout' });
          onClose();
        }}
      >
        레이아웃 내보내기
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'importLayout' });
          onClose();
        }}
      >
        레이아웃 가져오기
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'addExternalAssetDirectory' });
          onClose();
        }}
      >
        에셋 폴더 추가
      </MenuItem>
      {externalAssetDirectories.map((dir) => (
        <div key={dir} className="flex items-center justify-between py-4 px-10 gap-8">
          <span
            className="text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
            title={dir}
          >
            {dir.split(/[/\\]/).pop() ?? dir}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => transport.send({ type: 'removeExternalAssetDirectory', path: dir })}
            className="shrink-0"
          >
            x
          </Button>
        </div>
      ))}
      <Checkbox
        label="알림음"
        checked={soundLocal}
        onChange={() => {
          const newVal = !isSoundEnabled();
          setSoundEnabled(newVal);
          setSoundLocal(newVal);
          transport.send({ type: 'setSoundEnabled', enabled: newVal });
        }}
      />
      <Checkbox
        label="모든 세션 감시"
        checked={watchAllSessions}
        onChange={onToggleWatchAllSessions}
      />
      <Checkbox label="즉시 감지 (Hooks)" checked={hooksEnabled} onChange={onToggleHooksEnabled} />
      <Checkbox
        label="라벨 항상 표시"
        checked={alwaysShowOverlay}
        onChange={onToggleAlwaysShowOverlay}
      />
      <Checkbox label="디버그 보기" checked={isDebugMode} onChange={onToggleDebugMode} />
    </Modal>
  );
}
