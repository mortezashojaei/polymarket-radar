# Polymarket Radar

Public Telegram channel bot for hourly, read-only Polymarket political market signals.

## Stack
- Node.js + TypeScript
- SQLite (lightweight dedupe/run logs)
- Docker / Docker Compose
- GitHub Actions CI/CD -> GHCR -> Ubuntu VPS

## Local run
```bash
cp .env.example .env
npm ci
npm run dev
```

## Local docker run
```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up -d --build
```

## Production deploy flow
1. Create `/opt/polymarket-radar` on VPS.
2. Put `docker-compose.yml` and `.env` there.
3. Ensure Docker + Compose plugin installed.
4. Add GitHub secrets:
   - `DEPLOY_HOST`
   - `DEPLOY_USER`
   - `DEPLOY_SSH_KEY`
5. Push to `main`.

The workflow builds image `ghcr.io/<owner>/polymarket-radar:latest`, then SSH deploys.

## Notes
- SQLite file is persisted at `./data/radar.db` via bind mount.
- If branch is currently `master`, rename to `main` before expecting auto deploy.
- No LLM/API key required; messages are deterministic templates.
