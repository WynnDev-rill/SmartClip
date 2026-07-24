# SmartClip

SmartClip is a lightweight, algorithm-driven video highlight generator. Its guiding constraint is simple: produce a small number of genuinely useful clips—or no clips when the source has no strong highlights. It will not rely on paid APIs, AI APIs, or cloud AI services.

> **Foundation status:** local video upload and technical metadata inspection are available. Analysis, clipping, subtitles, and export are not implemented yet.

## Architecture

```text
SmartClip/
├── frontend/                 React + Vite + TypeScript application
│   ├── src/components/ui/    Reusable shadcn/ui primitives
│   ├── src/lib/              API client and shared utilities
│   └── src/App.tsx           Landing experience
├── backend/                  FastAPI service
│   ├── app/api/routes/       Thin HTTP route modules
│   ├── app/core/             Environment-driven configuration
│   └── tests/                API contract tests
├── .github/workflows/        Continuous integration
└── docker-compose.yml        Production-like local stack
```

### Architectural decisions

- **Explicit service boundary.** Frontend and backend are independently buildable and deployable. The browser communicates through `/api`, keeping UI concerns separate from future compute-heavy media jobs.
- **Application factory and route modules.** FastAPI setup lives in `create_app`, while endpoints are isolated by domain. Future upload, analysis, job, and export routers can grow without turning the entry point into a monolith.
- **Centralized typed configuration.** `pydantic-settings` validates environment configuration and provides an obvious home for future FFmpeg and storage options.
- **Small component layer.** shadcn/ui-style components are owned by the repository rather than hidden behind a component dependency. Tailwind tokens establish a consistent dark visual system while remaining easy to evolve.
- **One API adapter.** Browser networking is isolated in `src/lib/api.ts`; UI components do not need to know deployment URLs. Vite proxies `/api` in development and nginx proxies it in Docker.
- **No premature processing abstraction.** FFmpeg and highlight algorithms are deliberately absent. They will be introduced behind tested service interfaces when their requirements are known.
- **Multi-stage containers.** The frontend compiles to static assets served by nginx, while the backend uses a compact Python runtime. Compose wires the services together and waits for API health.

## Local development

### Prerequisites

- Node.js 22+
- Python 3.11+

```bash
# Terminal 1: API
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload

# Terminal 2: web app
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite forwards the UI health request to <http://localhost:8000/api/health>. API documentation is available at <http://localhost:8000/docs>.

Uploads support MP4, MOV, MKV, and WEBM. The API streams each upload into temporary
storage, inspects it with `ffprobe`, and removes temporary media at shutdown. Configure
the byte limit with `SMARTCLIP_MAX_UPLOAD_SIZE` and storage location with
`SMARTCLIP_UPLOAD_DIRECTORY`.

To point the frontend at a separately hosted API, set `VITE_API_URL` (including its `/api` suffix) before building.

## Docker

```bash
docker compose up --build
```

The web application is served at <http://localhost:3000>; the API remains directly available at <http://localhost:8000> for development and inspection.

## Quality checks

```bash
cd frontend && npm run lint && npm run typecheck && npm test -- --run && npm run build
cd backend && ruff check . && pytest
```

GitHub Actions runs these same frontend build, backend lint, and backend test gates on pushes and pull requests.

## Roadmap (not yet implemented)

Scene detection, voice activity detection, highlight scoring, natural ending detection, facecam layouts, vertical 9:16 export, and optional subtitles will arrive as separately tested modules. FFmpeg will be the media-processing foundation.
