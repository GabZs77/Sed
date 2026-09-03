# AGENTS.md

## Project overview
SED Aluno is a **static frontend** (compiled React bundle) with a **local Node.js backend** that proxies SED/EduSP APIs.

### Frontend (static)
- `index.html` — entry point
- `style.css` — compiled styles
- `script.js` — compiled production React bundle (~731KB). `WORKER_URL` is set to `"/api"` (relative), so all API calls go through nginx → backend.
- `EF/` and `EM/` — PDF apostilas served as static assets

### Backend (Node.js, replaces the original Cloudflare Worker)
- `server/server.js` — local proxy implementing all worker routes:
  - `/login` (POST) — SED login via `LoginCompletoToken` + EduSP token exchange
  - `/dashboard` (GET) — parallel fetch of turmas, faltas, notifications, aluno, agenda, tasks
  - `/student-rooms` (GET) — turmas for a student
  - `/boletim` (GET) — full boletim via `GetBoletimCompleto`
  - `/presenca` (GET) — frequency via `ConsultaFrequenciaBimestre` + `GetFaltasBimestreAtual` + `ConsultaFechamentoComparativo`
  - `/tarefas` (GET) — EduSP tasks via `/tms/task/todo`
  - `/pdf-proxy` (GET) — proxies PDFs from raw.githubusercontent.com
  - `/captcha/challenge`, `/captcha/verify` — EduSP captcha
  - `/task-details`, `/answer-task` — task details and submission
  - `/groq-chat`, `/groq-help` — Groq AI assistant
- `server/package.json` — minimal (no dependencies, Node 22 native fetch)

### nginx
- `nginx.conf` — serves static files, proxies `/api/*` to backend (stripping `/api` prefix), SPA fallback

## Architecture
```
Browser → nginx (:3000) → static files (frontend)
                        → /api/* → Node backend (:8001) → SED/EduSP APIs
```

## Secrets
- `SED_SUBSCRIPTION_KEY` — Azure APIM key for SED APIs (required at boot)
- `GROQ_API_KEY` — Groq API key for AI assistant (optional)
Both delivered via `/run/base44/app.env`, loaded as last `env_file` in compose.

## Key fixes applied
1. Replaced dead Cloudflare Worker URL with local backend (`/api` prefix through nginx)
2. Fixed PDF.js worker — changed from non-existent `/assets/pdf.worker.min-DKQKFyKK.js` to CDN URL
3. Added missing routes (`/boletim`, `/presenca`, `/tarefas`) that the frontend calls via `fetchOptional` but the original worker didn't implement
4. Fixed `fetchFaltas` URL — was missing `/saladofuturobffapi` prefix (bug in original worker)

## How to verify
```bash
docker compose -f docker-compose.base44.yml up -d --build
curl -sf http://localhost:3000/                         # frontend
curl -sf http://localhost:3000/api/health               # backend health
curl -sf -H "Host: external" http://localhost:3000/     # external host
```
User must **log out and log in again** after the backend change — old session tokens from the Cloudflare Worker are expired.

## Editing
- Frontend: edit `index.html`/`style.css`/`script.js` (bind-mounted, no live reload — call `reload_preview`)
- Backend: edit `server/server.js`, then `docker compose -f docker-compose.base44.yml restart backend`
