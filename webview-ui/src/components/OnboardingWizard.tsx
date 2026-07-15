import { useEffect, useState } from 'react';

import type {
  AuthMode,
  OfficeProviderInfo,
  SetupCheck,
  SetupCheckResultInfo,
  SetupCheckStatus,
} from '../hooks/useExtensionMessages.js';
import { setupCheckCopy } from '../setupCheckCopy.js';
import { transport } from '../transport/index.js';
import { FolderPicker } from './FolderPicker.js';
import { ProviderPicker } from './ProviderPicker.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  officeProvider: OfficeProviderInfo | null;
  setupCheckResult: SetupCheckResultInfo | null;
}

const MODE_EXPLANATION: Record<AuthMode, string> = {
  subscription:
    '이 PC에 Claude Code 설치 + 로그인이 필요합니다(내 구독으로만 동작). 이 앱을 남에게 배포·공유할 경우, 각자 자기 PC에서 로그인해야 합니다.',
  apiKey:
    'console.anthropic.com에서 발급 (결제수단 필요). 남에게 나눠줄 앱이라면 이 방식이 정식 경로입니다.',
};

function statusDotClass(status: SetupCheckStatus): string {
  if (status === 'ok') return 'bg-status-success';
  if (status === 'fail') return 'bg-status-error';
  return 'bg-text-muted';
}

function SetupCheckRow({ check }: { check: SetupCheck }) {
  const copy = setupCheckCopy(check);
  return (
    <div className="flex items-start gap-8 py-2">
      <div className={`w-6 h-6 rounded-full shrink-0 mt-2 ${statusDotClass(check.status)}`} />
      <div className="flex flex-col gap-1">
        <span className="text-xs">{copy.label}</span>
        {copy.message && <span className="text-2xs text-text-muted">{copy.message}</span>}
        {copy.docsUrl && (
          <a
            href={copy.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-2xs text-accent underline"
          >
            문서 보기
          </a>
        )}
        {check.status === 'fail' && check.detail && (
          <span className="text-2xs text-text-muted">{check.detail}</span>
        )}
      </div>
    </div>
  );
}

export function OnboardingWizard({
  isOpen,
  onClose,
  officeProvider,
  setupCheckResult,
}: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<AuthMode>(officeProvider?.mode ?? 'subscription');
  const [secret, setSecret] = useState('');
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);

  // Every fresh open (first run, or "온보딩 다시 보기") starts clean at step 1 —
  // simpler than trying to resume wherever a previous visit left off.
  useEffect(() => {
    if (isOpen) setStep(1);
  }, [isOpen]);

  const hasSecret = officeProvider?.mode === mode && (officeProvider?.hasSecret ?? false);
  const canProceedStep1 = mode !== 'apiKey' || secret.trim() !== '' || hasSecret;

  const finish = () => {
    transport.send({ type: 'setOnboardingDone', done: true });
    onClose();
  };

  const handleNext = () => {
    transport.send({
      type: 'setOfficeProvider',
      mode,
      ...(mode === 'apiKey' ? { apiKey: secret.trim() } : {}),
    });
    transport.send({ type: 'runSetupCheck', mode });
    setStep(2);
  };

  const handleRecheck = () => {
    transport.send({ type: 'runSetupCheck', mode });
  };

  const handleHire = () => {
    if (!name.trim() || !cwd.trim()) return;
    // The wizard's own hire is always the office's first employee — role
    // 'lead' (the only rank that may delegate; the office had nobody before
    // this, so hasLead is always false here). See StaffPanel.hire() for the
    // same rule applied to every later hire.
    transport.send({ type: 'hireEmployee', name: name.trim(), cwd: cwd.trim(), role: 'lead' });
    finish();
  };

  const resultReady = setupCheckResult?.mode === mode && setupCheckResult.checks.length > 0;

  return (
    <>
      <Modal isOpen={isOpen} onClose={finish} title={`온보딩 (${step}/3)`} zIndex={60}>
        <div className="flex flex-col gap-8 px-10 pb-6 min-w-sm max-w-sm">
          {step === 1 && (
            <>
              <span className="text-sm text-text-muted">
                직원을 고용하려면 먼저 어떤 AI로 일할지 정해주세요.
              </span>
              <ProviderPicker
                mode={mode}
                onModeChange={(m) => setMode(m === 'office' ? 'subscription' : m)}
                secret={secret}
                onSecretChange={setSecret}
                includeOffice={false}
                hasSecret={hasSecret}
              />
              <span className="text-2xs text-text-muted">{MODE_EXPLANATION[mode]}</span>
              <Button
                variant={canProceedStep1 ? 'accent' : 'disabled'}
                size="sm"
                onClick={handleNext}
                disabled={!canProceedStep1}
                data-testid="onboarding-next"
              >
                다음
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              {resultReady ? (
                <div className="flex flex-col gap-2">
                  {setupCheckResult.checks.map((check) => (
                    <SetupCheckRow key={check.id} check={check} />
                  ))}
                </div>
              ) : (
                <span className="text-xs text-text-muted">검사 중…</span>
              )}
              <div className="flex gap-4 pt-4">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleRecheck}
                  data-testid="onboarding-recheck"
                >
                  다시 검사
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  모드 바꾸기
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep(3)}
                  data-testid="onboarding-continue-anyway"
                >
                  그래도 계속
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <span className="text-sm text-text-muted">
                첫 직원을 고용해보세요. 나중에 언제든 추가할 수 있습니다.
              </span>
              <input
                className="bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름 (예: 비서)"
                data-testid="onboarding-hire-name"
              />
              <div className="flex gap-2">
                <input
                  className="flex-1 min-w-0 bg-bg-dark border-2 border-border rounded-none px-6 py-4 font-mono text-xs text-text outline-none"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="담당 폴더 (절대 경로)"
                  data-testid="onboarding-hire-cwd"
                />
                <Button variant="default" size="sm" onClick={() => setIsFolderPickerOpen(true)}>
                  불러오기
                </Button>
              </div>
              <div className="flex gap-4 pt-4">
                <Button
                  variant={name.trim() && cwd.trim() ? 'accent' : 'disabled'}
                  size="sm"
                  onClick={handleHire}
                  disabled={!name.trim() || !cwd.trim()}
                  data-testid="onboarding-hire"
                >
                  고용하고 시작
                </Button>
                <Button variant="ghost" size="sm" onClick={finish} data-testid="onboarding-skip">
                  건너뛰기
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
      <FolderPicker
        isOpen={isFolderPickerOpen}
        onClose={() => setIsFolderPickerOpen(false)}
        onSelect={(path) => {
          setCwd(path);
          setIsFolderPickerOpen(false);
        }}
      />
    </>
  );
}
