# Dockerfile — AI 오피스 헤드리스 서버 (멀티스테이지)

# ──────────────────────────────────────────────────────────────
# Stage 1: builder — 전체 빌드 (npm install, 컴파일, webview)
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# 의존성 설치용 패키지 파일만 먼저 복사 (Docker 캐시 활용)
# npm workspaces: 루트 lock만 있고 각 workspace package.json은 따로 있음
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY webview-ui/package.json ./webview-ui/

# npm install
RUN npm ci

# 전체 소스 코드 복사
COPY . .

# 컴파일: esbuild + webview 빌드
# npm run compile = typecheck + lint + esbuild + webview build
RUN npm run compile

# ──────────────────────────────────────────────────────────────
# Stage 2: runtime — 최소 이미지
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# claude CLI 설치 (subscription 모드 지원)
# 참고: claude-code는 Node.js 기반이므로 npm으로 설치 가능
RUN npm install -g @anthropic-ai/claude-code

# non-root 유저 생성
RUN addgroup -g 1001 -S app && \
    adduser -u 1001 -S app -G app && \
    mkdir -p /app/.pixel-agents && \
    chown -R app:app /app

# builder에서 dist/ 파일만 복사
COPY --from=builder --chown=app:app /build/dist ./dist

# 런타임 의존성만 설치
# package.json + package-lock.json 복사 후 npm ci --production
# --ignore-scripts: prepare(husky) 등 빌드 도구 스크립트는 runtime에 불필요
COPY --chown=app:app package.json package-lock.json ./
RUN npm ci --production --ignore-scripts

# 유저 전환
USER app

# 환경변수 기본값
ENV NODE_ENV=production
ENV PORT=3100
ENV HOST=0.0.0.0

# 헬스체크 (M1 검증용)
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3100/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# 진입점
EXPOSE 3100
CMD ["node", "dist/cli.js", "--host", "0.0.0.0", "--port", "3100"]
