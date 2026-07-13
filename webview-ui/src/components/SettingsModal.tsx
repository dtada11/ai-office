import { useEffect, useState } from 'react';

import type { OfficeProviderInfo } from '../hooks/useExtensionMessages.js';
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { transport } from '../transport/index.js';
import { ProviderPicker } from './ProviderPicker.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The office's default AI; every employee without one of their own runs on it. */
  officeProvider: OfficeProviderInfo | null;
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
  officeProvider,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const [providerMode, setProviderMode] = useState(officeProvider?.mode ?? 'subscription');
  const [providerSecret, setProviderSecret] = useState('');

  // The server is the authority: adopt what it reports, and drop whatever was
  // half-typed, so the panel never claims a setting that was not saved.
  useEffect(() => {
    if (officeProvider) setProviderMode(officeProvider.mode);
    setProviderSecret('');
  }, [officeProvider]);

  const saveProvider = () => {
    transport.send({
      type: 'setOfficeProvider',
      mode: providerMode,
      ...(providerMode === 'apiKey' ? { apiKey: providerSecret.trim() } : {}),
      ...(providerMode === 'oauthToken' ? { oauthToken: providerSecret.trim() } : {}),
    });
  };

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

      <div className="flex flex-col gap-4 border-t-2 border-border pt-6 mt-4 px-10 pb-4">
        <span className="text-xs">사무실 기본 AI</span>
        <span className="text-xs text-text-muted">
          직접 연결한 직원 외에는 모두 이걸로 일합니다. 지금 일하고 있는 직원은 그대로 두고, 앞으로
          고용하는 직원부터 적용됩니다.
        </span>
        <ProviderPicker
          mode={providerMode}
          onModeChange={(m) => setProviderMode(m === 'office' ? 'subscription' : m)}
          secret={providerSecret}
          onSecretChange={setProviderSecret}
          includeOffice={false}
          hasSecret={officeProvider?.mode === providerMode && officeProvider.hasSecret}
        />
        <Button
          variant="default"
          size="sm"
          onClick={saveProvider}
          data-testid="save-office-provider"
        >
          저장
        </Button>
      </div>
    </Modal>
  );
}
