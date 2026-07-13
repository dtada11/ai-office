import type { AuthMode } from '../hooks/useExtensionMessages.js';

/** Which AI to plug in. Used twice: for the office default (Settings) and for a
 *  single employee at hire time (Staff panel), where "office" is also an option. */

/** `office` is not an auth mode — it means "don't override, follow the office". */
export type PickedMode = AuthMode | 'office';

const LABELS: Record<PickedMode, string> = {
  office: '사무실 기본 따름',
  subscription: '구독 (이 PC의 Claude 로그인)',
  oauthToken: 'setup-token (claude setup-token)',
  apiKey: 'API 키 (종량제)',
};

interface ProviderPickerProps {
  mode: PickedMode;
  onModeChange: (mode: PickedMode) => void;
  /** The key/token being typed. Blank + `hasSecret` = keep the stored one. */
  secret: string;
  onSecretChange: (secret: string) => void;
  /** Offer "follow the office default" — true for an employee, false for the office itself. */
  includeOffice: boolean;
  /** A secret is already on file for this mode (the server never sends it back). */
  hasSecret?: boolean;
}

export function ProviderPicker({
  mode,
  onModeChange,
  secret,
  onSecretChange,
  includeOffice,
  hasSecret,
}: ProviderPickerProps) {
  const modes: PickedMode[] = includeOffice
    ? ['office', 'subscription', 'oauthToken', 'apiKey']
    : ['subscription', 'oauthToken', 'apiKey'];

  const needsSecret = mode === 'apiKey' || mode === 'oauthToken';

  return (
    <div className="flex flex-col gap-4">
      {modes.map((m) => (
        <label key={m} className="flex items-center gap-4 text-xs cursor-pointer">
          <input
            type="radio"
            checked={mode === m}
            onChange={() => onModeChange(m)}
            data-testid={`provider-mode-${m}`}
          />
          {LABELS[m]}
        </label>
      ))}
      {needsSecret && (
        <input
          type="password"
          className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
          value={secret}
          onChange={(e) => onSecretChange(e.target.value)}
          placeholder={
            hasSecret
              ? '저장됨 · 바꾸려면 새로 입력'
              : mode === 'apiKey'
                ? 'sk-ant-...'
                : 'setup-token 값 붙여넣기'
          }
          data-testid="provider-secret"
        />
      )}
    </div>
  );
}
