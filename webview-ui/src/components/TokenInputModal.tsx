import { useEffect, useState } from 'react';

import { Modal } from './ui/Modal.js';

interface TokenInputModalProps {
  isOpen: boolean;
  onTokenSubmit: (token: string) => void;
}

/**
 * M4: 원격 클라이언트 token 입력 모달
 * 로컬(localhost/127.0.0.1)이 아닌 원격 호스트에서 접속할 때,
 * 사용자가 token을 입력하고 localStorage에 저장하는 UI.
 *
 * 로컬은 server.json에서 자동 발견되므로 이 모달이 띄워지지 않음.
 */
export function TokenInputModal({ isOpen, onTokenSubmit }: TokenInputModalProps) {
  const [token, setToken] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    // 모달이 닫혀도 상태 유지 (한 번 입력하면 재입력 불필요)
    if (!isOpen && token) {
      setSubmitted(true);
    }
  }, [isOpen, token]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      onTokenSubmit(token.trim());
      setToken('');
    }
  };

  // 이미 token이 있으면 모달을 띄우지 않음
  if (submitted) {
    return null;
  }

  return (
    <Modal isOpen={isOpen} title="Authentication Token" onClose={() => {}}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--color-text-muted)',
            marginBottom: '16px',
          }}
        >
          이 서버는 원격 호스트에서 실행 중입니다. API 접근을 위해 token을 입력하세요.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Token (e.g., from PIXEL_AGENTS_TOKEN or docker logs)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '16px',
              border: `1px solid var(--color-border)`,
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            autoFocus
          />
          <button
            type="submit"
            disabled={!token.trim()}
            style={{
              width: '100%',
              padding: '8px',
              backgroundColor: token.trim() ? 'var(--color-accent)' : 'var(--color-border)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: token.trim() ? 'pointer' : 'default',
              fontSize: '14px',
            }}
          >
            저장 및 계속
          </button>
        </form>
        <p
          style={{
            fontSize: '12px',
            color: 'var(--color-text-muted)',
            marginTop: '16px',
          }}
        >
          ⚠️ 이 token은 localStorage에만 저장됩니다. 보안을 위해 신뢰할 수 있는 네트워크에서만
          입력하세요.
        </p>
      </div>
    </Modal>
  );
}
