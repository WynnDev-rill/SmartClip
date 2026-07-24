# SmartClip

SmartClip is a lightweight, algorithm-driven video highlight generator. Its guiding constraint is simple: produce a small number of genuinely useful clips—or no clips when the source has no strong highlights. It will not rely on paid APIs, AI APIs, or cloud AI services.

> **Foundation status:** this repository currently contains the application shell and health integration only. Video ingestion, analysis, clipping, subtitles, and export are intentionally not implemented yet.

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

To point the frontend at a separately hosted API, set `VITE_API_URL` (including its `/api` suffix) before building.

## Docker

```bash
docker compose up --build
```

The web application is served at <http://localhost:3000>; the API remains directly available at <http://localhost:8000> for development and inspection.

## Quality checks

```bash
cd frontend && npm run lint && npm run typecheck && npm run build
cd backend && ruff check . && pytest
```

GitHub Actions runs these same frontend build, backend lint, and backend test gates on pushes and pull requests.

## Roadmap (not yet implemented)

Scene detection, voice activity detection, highlight scoring, natural ending detection, facecam layouts, vertical 9:16 export, and optional subtitles will arrive as separately tested modules. FFmpeg will be the media-processing foundation.

## Local video uploads

The workspace accepts one **MP4, MOV, MKV, or WEBM** file through `POST /api/videos/upload`. The API streams the multipart body to an application-owned temporary path (never a user-supplied path), then runs `ffprobe` to validate the video and extract duration, dimensions, frame rate, codecs, and container metadata. Metadata is available from `GET /api/videos/{video_id}`; `DELETE /api/videos/{video_id}` removes both media and metadata.

Uploads default to a **2 GB** maximum and a **24-hour** lifetime. A background task and API requests clean up expired media. Configure deployments with `MAX_UPLOAD_SIZE_BYTES`, `UPLOAD_TTL_HOURS`, and `UPLOAD_DIRECTORY` (see `backend/.env.example`). A local backend installation requires **FFmpeg**, including `ffprobe`, on `PATH`; the backend Docker image installs it automatically. Temporary storage is container-local by default, so mount a volume when it must survive container replacement during its configured lifetime.
