# Android local-first architecture

## Architecture audit: today

SmartClip is currently a two-service web application. The React 19, TypeScript, Vite, and Tailwind frontend owns the dark upload and metadata UI. Its single API adapter sends multipart uploads to FastAPI. FastAPI streams temporary video files, invokes `ffprobe`, returns technical metadata, and deletes uploads. nginx/Vite proxy `/api`; Docker Compose connects the independently deployed services. This backend is **transitional** and remains available for browser development during migration.

## Target architecture

The target is an Android application whose Capacitor WebView loads the compiled React bundle from the APK. React remains the presentation layer. Native plugins will select user media through Android's system picker and expose narrowly scoped, Kotlin-based on-device processing services. A packaged local FFmpeg engine will inspect and transform media in application-controlled temporary storage. Scene detection, deterministic highlight scoring, clipping, preview, and export will execute on the device. The final runtime has no FastAPI, hosted website, Render, Railway, Cloudflare, paid API, AI API, cloud processor, or required network connection.

```text
Android APK
├── Capacitor WebView → bundled Vite assets (`frontend/dist`)
├── reusable React UI, state, validation, and presentation
├── typed Capacitor plugin boundary (future)
├── Android system document picker (future)
└── local media pipeline (future)
    ├── metadata / FFmpeg
    ├── scene and audio analysis
    ├── deterministic highlight scoring
    └── clip render and user-selected export
```

No `server.url` is configured in `capacitor.config.ts`: Capacitor copies and serves `webDir` locally. The manifest requests no storage, camera, microphone, or internet permissions. Picker grants provide narrow source access and Android 10+ scoped `MediaStore` creates app-owned results.

## Trim and vertical composition pipelines

React owns range validation, presets, state presentation, and the Android/browser boundary. The native plugin opens the `content://` source with `MediaExtractor`, accepts H.264 and AAC tracks, seeks to the next sync sample, and copies compressed samples to an MP4 `MediaMuxer`. It preserves encoded dimensions and carries the rotation hint. No decode, re-encode, third-party media dependency, backend call, or network request occurs.

The muxer writes a seekable cache file, then a streaming phase fills an `IS_PENDING` `MediaStore` item and publishes it at `Movies/SmartClip`. Both phases check cancellation; failures remove pending and temporary output. Sample timestamps and copied bytes drive real progress. Sync alignment can move the actual start later. Other codecs are rejected until composition justifies a maintained local encoder.

Vertical export is that justified re-encode path. It uses **AndroidX Media3 1.8 Transformer/Effect/Common**, maintained as part of Jetpack, with platform `MediaCodec` acceleration. Stream copy cannot change pixels, so it cannot crop, scale, blur, round corners, composite facecam/gameplay, or change dimensions. The Transformer decodes locally, applies aspect-safe GPU effects, encodes H.264 to a cache MP4, retains compatible audio through the Media3 pipeline, and then publishes via the existing pending-item MediaStore flow. No native executable or binary is checked into this repository; Capacitor injects the text-based plugin and Gradle resolves the AndroidX artifacts.

The editor models source and output rectangles as normalized top-left coordinates `(x, y, width, height)` in `[0,1]`. A minimum width/height of `0.02` prevents degenerate regions, and every update clamps the rectangle to its parent bounds. Source crop coordinates are converted to Media3 normalized-device coordinates only at the native boundary. Cover and contain calculations preserve the source aspect ratio; pixels are never stretched.

Modes and presets are:

- **Smart Crop:** aspect-fill cover crop with horizontal/vertical focal point and 1–4× zoom.
- **Fit with Background:** full gameplay is kept visible with a solid letterbox background. Blur is deferred because the minimal Media3 1.8 path does not yet implement a tested two-pass background.
- **Split (preview only):** gameplay plus an independently cropped facecam at top, bottom, or one of four corners. Native export rejects this mode explicitly.
- **Manual Overlay (preview only):** draggable/resizable facecam output with corner-radius control over the gameplay base. Native export rejects this mode explicitly.
- Presets cover gameplay full, both top/bottom splits, corner facecam, and fit with a solid background.

Auto quality chooses `1080×1920` only when source detail and reported device memory make that practical; otherwise it selects `720×1280`. Both explicit sizes are available and upscaling is warned about. Encoder availability, thermal throttling, long render time, temporary-space requirements, and device-specific codec limits remain expected constraints. The bridge reports preparing, rendering, saving, completed, failed, and cancelled states; cancellation stops Transformer or copy work and pending gallery entries are removed. Source permission loss, unsupported decode, storage pressure, and rendering failures have distinct user-facing errors. Export currently runs while the app process remains alive; Android process death/background eviction cancels the in-process job and cache cleanup occurs on the next system cache sweep.

## APK identity, versions, and signing

The generated Android application keeps the package/application ID `com.wynndev.smartclip`. Development APKs use Gradle's automatically managed debug keystore and are suitable only for development; a debug APK cannot update a release-signed installation.

Distributable APKs use persistent release signing. GitHub Actions decodes the permanent keystore secret into the runner's temporary directory and supplies its path and credentials to a release-only Gradle init script through environment variables. Gradle applies the release signing configuration to `:app`, the APK signature is verified with `apksigner`, the APK is uploaded, and an always-running cleanup step deletes the temporary keystore. The keystore and credentials never belong in Git, artifacts, Gradle properties, or logs.

Android's update trust is based on certificate continuity: the new APK must have the same application ID and be signed by the same certificate as the installed APK. It must also have a greater `versionCode`. Creating a new key—even with the same alias and passwords—creates a different certificate and prevents an in-place update. `frontend/android-version.properties` is the source of truth for `VERSION_CODE` and `VERSION_NAME`; the release init script applies them after Capacitor generates the native project.

## Reuse and replacement map

| Area | Reuse | Migration action |
| --- | --- | --- |
| React/Tailwind UI and UI primitives | Reuse directly | Add safe-area and mobile layouts; replace network progress with local job progress. |
| File validation and metadata presentation | Reuse concepts and types | Source data from a typed native bridge rather than HTTP. |
| `src/lib/api.ts` | Browser-only transitional adapter | Replace with a platform-neutral media service and native implementation. |
| FastAPI upload/temp-file lifecycle | No Android runtime dependency | Replace with Android URIs, scoped cache, and lifecycle-aware cleanup. |
| `ffprobe` metadata route | Contract may guide native types | Replace with packaged on-device probing. |
| nginx, Docker Compose, hosted deployment | Development/transitional only | Remove after browser compatibility and native processing migration are complete. |
| Backend tests | Retain while backend exists | Add native unit/instrumentation tests and JS bridge contract tests. |

The first Android build deliberately disables server-backed upload inside Capacitor. Browser behavior remains intact, which keeps existing frontend/backend development usable without making the APK depend on an API URL.

## Risks

- Android ABI packaging, FFmpeg licensing, binary size, and performance require deliberate engine selection.
- Large videos can exhaust memory, storage, battery, or thermal budgets; processing must stream, report progress, cancel, and clean up safely.
- Content URIs are not ordinary file paths and permissions may be short-lived.
- Web/native bridge contracts can drift; shared schemas and contract tests are needed.
- WebView lifecycle events, process death, rotation, and background execution require recoverable job state. Portrait is intentionally fixed for this foundation, but process death still matters.
- Edge-to-edge displays, accessibility, small screens, and OEM WebView differences require device testing.
- Keeping browser and native paths temporarily creates two implementations and an explicit deprecation burden.

## Phased migration

1. **Foundation (this PR):** Capacitor configuration, CI-generated Android project, local bundled assets, platform detection, safe-area UI, build scripts, and debug APK CI. The generated native tree is ignored so source changes remain text-only.
2. **Local media access:** system picker, persisted URI access when necessary, native metadata contract, cancellation, and temporary-file policy.
3. **Processing engine:** select and package a license-compatible local FFmpeg implementation; probe and transcode on supported ABIs with no network.
4. **Analysis:** implement deterministic scene/audio signals and highlight scoring with fixtures and performance budgets.
5. **Clip workflow:** manual trim, Smart Crop/Fit export, 9:16 facecam/gameplay preview controls, cancellation, and MediaStore publishing are complete. Multi-input facecam rendering and blur remain renderer work.
6. **Automatic highlights (this PR):** candidate generation from deterministic local signals, natural-boundary validation, multi-selection, and sequential vertical export.
7. **Hardening:** lifecycle recovery, instrumentation/device matrix, accessibility, performance, storage pressure, and privacy review.
8. **Retirement:** remove hosted API requirements and eventually the transitional backend/deployment after all required functionality is local.

## Automatic highlight analysis

The Android plugin reads the persisted source `content://` URI directly on a single background executor. It never copies the complete source and never contacts FastAPI or another network service. At a configurable one-second interval (minimum 500 ms), `MediaMetadataRetriever` obtains sync-near frames which are reduced to 32×18 before luminance-difference motion analysis. `MediaExtractor` groups audio packet energy by the same windows. Luminance discontinuities provide a deliberately simple scene-transition signal. This v1 proxy is not speech, face, object, or text recognition and uses no model. Every retriever, extractor, bitmap, buffer, and executor is released; cancellation is checked throughout. Videos over the configurable **60-minute** default limit are rejected.

Pure TypeScript normalizes each signal independently, combines activity as **45% audio, 40% motion, and 15% scene activity**, finds local peaks, and expands each peak backward to low activity, a scene boundary, or the mode's maximum lead-in. It expands forward through the event to a low-energy/scene boundary and adds cooldown. If activity is still rising at the provisional end, the engine extends to a safe boundary within the hard maximum; if it still ends at high/rising activity, the candidate is rejected. Target ranges are flexible: 30+ prefers 30–50 seconds (hard 20–75), 60+ prefers 60–90 (hard 45–120), and Auto prefers 20–90 (hard 15–105). Complete moments take priority over an exact duration.

The deterministic 0–100 score uses these maximum positive weights: audio strength **22**, motion strength **20**, scene relevance **8**, continuity **14**, clean start **8**, clean ending **12**, and duration suitability **10**. Penalties are incomplete ending **−25**, repetition **−8**, low activity **−15**, and **−6 per unavailable signal**. Scores are clamped and rounded. Conservative/Balanced/Aggressive thresholds are 70/55/45 with maximum counts 3/5/8. Candidates sharing at least 65% of the shorter range, or essentially the same peak, are de-duplicated in favor of the higher score.

Confidence labels are Low (<50), Medium (50–69), High (70–84), and Very High (85–100). The UI calls this **Viral Confidence** only as approachable product language: it is a heuristic highlight-quality score, does not predict an online audience, and cannot guarantee virality. Signal failures reduce the score and are disclosed in reasons; analysis proceeds only with the remaining measurable activity. Flat footage, incomplete endings, or all scores below the selected threshold returns the honest message **“No strong highlight found.”**

Browser builds expose the candidate controls for UI and mocked-signal tests, but clearly state real analysis and export are Android-only and never call the backend. Current limitations include coarse sync-frame sampling, packet energy rather than semantic audio understanding, device codec variability, no process-death recovery, and no analysis beyond one hour. Privacy is local by construction: source grants, sampled values, candidates, previews, and exports remain on device. The next processing step is a separate, opt-in URL-processing backend deployed on Render; it is not implemented or used by this local path.

## Opt-in URL architecture

SmartClip now has two explicitly separated source modes. Local Android sources continue through the existing `content://` and on-device analysis/render/export pipeline and are never uploaded. URL mode stores no local URI: it submits only the public URL to the authenticated private Render backend, polls its temporary job, and downloads selected output candidates. Build-time `VITE_SMARTCLIP_BACKEND_URL` and `VITE_SMARTCLIP_API_TOKEN` values originate from the `SMARTCLIP_BACKEND_URL` and `SMARTCLIP_API_TOKEN` GitHub Secrets. A missing token disables this mode rather than attempting unauthenticated requests.

URL result bytes bypass JavaScript: the Capacitor plugin uses `HttpURLConnection` with an Authorization header and bounded connect/read timeouts, copies a fixed-size buffer into an Android 10+ pending MediaStore video, publishes on success, and deletes partial output on failure or cancellation. Downloads are HTTPS-only and selected candidates are queued sequentially. `android.permission.INTERNET` is the sole new permission; scoped MediaStore requires no broad storage permission, and cleartext remains disabled by Android's default network policy.
# Mobile interface

The React layer now uses a safe-area-aware application shell and portrait-first design tokens. Local source, native analysis, trimming, composition, and MediaStore calls are unchanged; the Projects and Downloads views persist only lightweight known-session records and never request broader media access. See [UI architecture](ui-architecture.md).
