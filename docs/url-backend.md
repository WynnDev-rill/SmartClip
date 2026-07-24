# URL processing backend

This private, single-process FastAPI service is separate from Android's local-first pipeline. It uses no AI key, AI API, speech-to-text, subtitles, accounts, database, Redis, persistent disk, or worker. Only process URLs you own or have permission to use.

## Pipeline and limits

`yt-dlp` inspects metadata, then downloads one non-playlist representation (video at the requested ceiling plus audio) into a cryptographically named job directory. FFprobe/FFmpeg provide media signals; deterministic Python scoring combines audio energy, downscaled visual motion, scene changes, low-energy boundaries, natural endings, and overlap suppression. Accepted ranges are rendered sequentially with FFmpeg to H.264/AAC, yuv420p, fast-start vertical MP4. Smart Crop center-crops; Fit Background fits the full frame over blur. Auto conservatively selects 720p; explicit 1080p is available and reports its actual resolution.

Sources default to at most 60 minutes and 1000 MB; outputs to 120 seconds and five candidates. Conservative/balanced/aggressive additionally cap results at 3/5/8. Strong candidates are never forced.

## API

`GET /health` is public. All others require `Authorization: Bearer $SMARTCLIP_API_TOKEN`: `POST /api/url/inspect`, `POST /api/jobs`, `GET /api/jobs/{job_id}`, `POST /api/jobs/{job_id}/cancel`, `GET /api/jobs/{job_id}/results`, and `GET /api/files/{job_id}/{filename}`. OpenAPI is at `/docs`.

## Security and lifetime

Only HTTP(S) is accepted. DNS is resolved before processing and every result must be a globally routable address, rejecting localhost, private, loopback, link-local, multicast, reserved IPv4/IPv6, and unsafe credentials. yt-dlp is invoked without shell/config/playlists/cookies. Arguments and output paths are fixed; downloads are job-owned. Redirects are ultimately constrained by yt-dlp, while initial and inspect/job destinations are revalidated; deployments should also apply an egress firewall for defense in depth. Errors and logs omit tokens, signed URLs, extractor headers, and subprocess output.

Completed files expire after 30 minutes. Failed/cancelled partials are deleted immediately; a periodic loop removes expired and orphan directories. Jobs and files disappear on restart, redeploy, or Render Free sleep.

## Environment

Required: `SMARTCLIP_API_TOKEN`. Optional defaults: `MAX_VIDEO_DURATION_MINUTES=60`, `MAX_CONCURRENT_JOBS=1`, `MAX_OUTPUT_CANDIDATES=5`, `JOB_EXPIRY_MINUTES=30`, `MAX_SOURCE_SIZE_MB=1000`, `MAX_OUTPUT_DURATION_SECONDS=120`, `TEMP_ROOT=/tmp/smartclip`, `LOG_LEVEL=INFO`, `ALLOWED_ORIGINS=` (no CORS), and Render-provided `PORT=8000`. Never use `*` for authenticated CORS.

## Develop and deploy

```bash
cd backend && cp .env.example .env && pip install -e '.[dev]'
uvicorn app.main:app --reload
docker build -t smartclip-url backend
docker run --rm -p 8000:8000 --env-file backend/.env smartclip-url
curl http://localhost:8000/health
curl -H "Authorization: Bearer $SMARTCLIP_API_TOKEN" -H 'Content-Type: application/json' -d '{"url":"https://www.youtube.com/watch?v=VIDEO"}' http://localhost:8000/api/url/inspect
```

Render Blueprint settings are in `render.yaml`: Docker Web Service, `main`, Free, automatic deploy, `/health`, and no other service. Free instances sleep, restart without persistence, have constrained CPU/RAM/disk, and can render much slower than video duration; long downloads/1080p may fail. This service makes no claim of unrestricted YouTube compatibility and supports public, non-DRM, non-login videos accepted by current yt-dlp. Cookies and sessions are deliberately unsupported. Next step is APK URL submission/status/result download integration; it is not part of this change.
