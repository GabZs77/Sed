# AGENTS.md

## Project overview
SED Aluno is a **static frontend** (no build step, no local backend).
- `index.html` — entry point
- `style.css` — compiled styles
- `script.js` — compiled production React bundle (single file, ~700KB)
- `EF/` and `EM/` — PDF apostilas served as static assets

## How it runs
Served as static files by `nginx:alpine` via `docker-compose.base44.yml` on host port 3000.
No package.json, no Node build, no dev server — `script.js` IS the shipped bundle.

## External dependencies
The frontend calls a remote Cloudflare Worker at `https://sdf.gabrielreplit56.workers.dev`
for SED API data and the Groq AI assistant. That worker (not in this repo) holds the
upstream subscription keys and `GROQ_API_KEY`. None of these are needed to serve the
static site locally; API calls will fail in the preview until the worker is reachable.

## Editing
Edits to `index.html` / `style.css` / `script.js` are reflected on reload (files are
bind-mounted). There is no live-reload dev server, so call `reload_preview` after
changes for the user to see them.

## Verify it works
```bash
docker compose -f docker-compose.base44.yml up -d --build
curl -sf http://localhost:3000/ | head   # should return index.html
```
