# dastyar ui

`dastyar ui` is a fork of Open WebUI tailored for Persian-speaking users. It keeps the upstream project structure mostly intact while adding full Farsi localization, RTL layout support, and a Persian-first experience across the interface.

## Highlights

- Full Persian localization and RTL layout
- Jalali date display through the Day.js wrapper
- RTL sidebar drag behavior fixed
- Minimal fork changes to keep merges with upstream manageable
- Designed to stay close to Open WebUI so cherry-pick updates remain practical

## Installation and Running

### Frontend

Install dependencies and start the Svelte frontend from the project root:

```bash
npm install
npm run dev
```

The frontend will be available on the local Vite development server.

### Backend

Run the backend separately from the `backend` directory:

```bash
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn open_webui.main:app --host 0.0.0.0 --port 8080 --reload
```

If you prefer the project-provided script on Linux or WSL, you can also use:

```bash
cd backend
./dev.sh
```

The backend serves the API on `http://localhost:8080`.

### Full Stack with Docker

Use Docker Compose to run the full stack:

```bash
docker compose up -d --build
```

This starts the Open WebUI backend together with Ollama. The UI is exposed on port `3000` by default.

If you want to run the single-container image instead, use:

```bash
docker build -t dastyar-ui .
docker run -d -p 3000:8080 --add-host=host.docker.internal:host-gateway -v dastyar-ui:/app/backend/data --name dastyar-ui --restart always dastyar-ui
```

## Updating from Upstream

This fork is intentionally kept small so it can be updated by cherry-picking upstream Open WebUI commits when needed. The recommended approach is to keep local changes focused on the Persian and RTL-specific layers, then bring in upstream fixes incrementally.

To minimize merge conflicts:

- Keep changes small and isolated
- Prefer reusable wrappers and localized overrides over broad rewrites
- Rebase or cherry-pick upstream commits regularly instead of accumulating a large divergence

## Notes

This repository is based on Open WebUI, but the user-facing experience has been adapted for Persian language usage and right-to-left interaction patterns. The goal is to preserve compatibility with upstream while making the product feel native for Farsi users.

