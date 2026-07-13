<h1 align="center">AI 오피스</h1>

<p align="center"><b>픽셀 오피스에서 AI 직원을 고용해 일 시키는 로컬 도구</b></p>

<p align="center">
  <a href="https://github.com/pixel-agents-hq/pixel-agents">Pixel Agents</a>(MIT) 기반 · Powered by Claude
</p>

---

AI 에이전트 하나하나가 픽셀 아트 사무실의 캐릭터가 됩니다. 직원을 고용하면 세션이 열리고, 캐릭터를 클릭하면 그 직원의 채팅창이 열립니다. 직원은 코드를 쓸 때 타이핑하고, 파일을 찾을 때 책을 읽고, 결재가 필요하면 당신을 기다립니다.

**전부 당신 컴퓨터에서 돕니다.** 별도 서버도, 계정 가입도 없습니다 — 사무실 상태는 `~/.pixel-agents/`에 저장되고, 직원이 실행하는 작업은 당신 PC 안에서만 돕니다.

## 원본(Pixel Agents)과 다른 점

| 기능                   | 설명                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| 🇰🇷 한글 UI             | 전체 인터페이스 한글화                                                                                          |
| 👔 직원 = 세션         | 고용하면 Claude Agent SDK 상주 세션이 열림. 캐릭터 클릭 = 그 직원의 채팅창, 여러 직원 동시 대화(맥락 완전 분리) |
| ✅ 결재 시스템         | 직원의 민감한 도구 사용(파일 쓰기 등)은 허용/거부 카드로 사용자가 결재                                          |
| 🏢 직급과 위임         | 부사장을 두면 팀원에게 일을 시키고 결과를 보고받음                                                              |
| 🔌 AI 직접 연결 (BYOK) | 사무실 기본 AI + 직원별 덮어쓰기 — 아래 3가지 방식                                                              |
| 📊 사용량 게이지       | 구독 플랜 소진율을 `/usage` 실측으로 보정(토큰 소모 0), API 키 직원은 누적 비용($) 표시                         |
| 🖥️ 터미널 세션 감지    | 터미널에서 직접 켠 Claude Code 세션도 캐릭터로 표시(훅 기반, 소유자 전용)                                       |

## AI 연결 방식

| 모드        | 누구용            | 방법                                              |
| ----------- | ----------------- | ------------------------------------------------- |
| 구독        | 본인              | 이 PC의 Claude Code 로그인을 그대로 사용 (설정 0) |
| setup-token | 본인 (원격 배포)  | `claude setup-token`으로 발급한 토큰 붙여넣기     |
| API 키      | 그 외 모든 사용자 | 자기 Anthropic API 키 연결 (종량제)               |

> 본인 소유가 아닌 환경에서는 API 키 방식을 사용하세요. 키는 `~/.pixel-agents/`에만 저장되며(권한 0600) 저장소나 화면으로 절대 나가지 않습니다.

## 설치와 실행

```bash
git clone https://github.com/dtada11/ai-office.git
cd ai-office
npm install && cd webview-ui && npm install && cd ..
npm run build
node dist/cli.js --port 3100
```

브라우저에서 `http://localhost:3100` 접속 → 직원 패널에서 이름·담당 폴더를 넣고 고용.

**요구사항**: Node.js, 그리고 [Claude Code CLI](https://code.claude.com/docs) 설치(구독 모드) 또는 Anthropic API 키.

## 원본 프로젝트와 크레딧

- 이 저장소는 [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents)를 기반으로 합니다. 원본의 문서·변경 이력은 원본 저장소를 참고하세요.
- 기본 캐릭터 도트는 [JIK-A-4, Metro City 캐릭터 팩](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)에 기반합니다.

## 라이선스

[MIT](LICENSE) — 원본 Pixel Agents의 라이선스를 그대로 따릅니다.
