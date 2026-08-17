# FaceOps Lab

FaceOps Lab is a Vietnamese web application for registering and recognizing a face with real [InsightFace](https://github.com/deepinsight/insightface) embeddings. It serves the frontend and API from the same FastAPI process, so the browser can use it without exposing models, database credentials, or embeddings to client-side JavaScript.

## What it does

| Feature | Behavior |
| --- | --- |
| Face registration | The user enters a name and the website automatically verifies a live camera subject before saving a quality-checked InsightFace embedding on the server. The same active browser session can add further captures to that identity. |
| Face recognition | The website automatically verifies one live camera subject before comparing it to the shared directory. It shows the stored name for a match, or `Chưa có dữ liệu` when there is not. |
| Client storage | The public registration and recognition flow stores neither a workspace token nor face embeddings in browser storage. |

## User interface

The website has three modules:

1. **Đăng ký** — enter a name and choose `Đăng ký khuôn mặt`. The camera captures the necessary frames automatically and saves a sample only after live verification succeeds. There is no image-upload control.
2. **Nhận diện** — opening this tab opens the camera and begins live verification automatically. Face boxes can track multiple people, but the system verifies and identifies one person at a time so it never labels an unverified person as live. If a photo, screen, or unchanged replay fails the challenge, the UI shows a warning instead of a name.
3. **Quản lý dữ liệu** — enter the server administrator token to view the directory, inspect each profile's stored samples and complete float32 embedding vectors, rename a profile, or delete one. It also states explicitly that source images are not stored. The token is kept only in the tab's memory and is never written to browser storage.

The UI sends only freshly captured webcam frames. The public registration and recognition APIs require a one-time liveness challenge; a request in static-image mode is rejected. While a camera is live, supported browsers use their local Face Detector API for a fast box overlay while InsightFace on the server determines identity. Browser-side registration tracking avoids redundant server requests; frames are resized to a 640 px maximum before they are sent for processing. Browsers without this API fall back to transient server tracking. Camera frames are not stored. After each registration or recognition, the processing trace is available on demand. The trace never includes raw images, embeddings, filesystem paths, or administrator tokens.

### Better enrollment and matching

- A profile can contain up to five enrollment samples by default. Immediately after the first registration, register again with the same name in the same browser tab to add another capture; vary it between straight ahead, slight left/right turn, and normal lighting. The server keeps one profile and compares a recognition embedding with every stored sample, selecting the highest similarity. A name by itself never adds a sample to an existing identity, so another public visitor cannot contaminate that person's profile simply by typing the same name.
- The maximum can be configured with `FACEOPS_MAX_SAMPLES_PER_PROFILE`. Administrators can inspect and delete one poor sample while the server protects the last usable sample. Do not turn the limit into an unbounded value: a small, curated set of high-quality and varied samples is more useful than many nearly identical frames.
- Administrators can run a non-destructive threshold diagnostic using same-profile and cross-profile sample pairs. It recommends a value but never changes `FACEOPS_MATCH_THRESHOLD`; use a separately labelled, consented evaluation set before changing production configuration.
- Before creating a sample, the API checks detected face size, detector confidence, blur (Laplacian variance), and exposure on the in-memory face crop. The configurable defaults are `FACEOPS_MIN_FACE_SIZE=120`, `FACEOPS_MIN_DETECTION_SCORE=0.65`, `FACEOPS_MIN_FACE_SHARPNESS=35`, `FACEOPS_MIN_FACE_BRIGHTNESS=45`, and `FACEOPS_MAX_FACE_BRIGHTNESS=220`.
- These image-quality checks improve recognition references; they are not liveness or presentation-attack detection. Do not treat a high quality score as proof that a person is physically present.

## Shared server storage

- The simple website uses one shared server-side directory. A face registered from device A can be recognized from device B, as long as both devices use the same deployed website and database.
- The browser does not persist a face embedding, image, profile, workspace token, administrator token, or enrollment continuation token. During the active registration tab only, it holds the continuation token in memory to let the person add their own varied samples; closing or reloading the tab clears it. The SQLite database in the server's persistent `/data` volume stores the name and InsightFace embedding.
- Public recognition requests do not return a list of registered names. A name is returned only after a submitted face reaches the configured match threshold; the administrator-only management API is the sole exception.
- Directory administration is protected by `FACEOPS_ADMIN_TOKEN`. It is required for `GET`, `PUT`, and `DELETE` requests to `/api/profiles`; public visitors cannot list, rename, or delete profiles.
- Submitted images are decoded in memory to make an embedding and are not written to the application database or file volume. Configure the reverse proxy and application logs so they do not capture request bodies, tokens, or raw images.
- Shared profiles are retained in the server database until an administrator deliberately removes them. `FACEOPS_RETENTION_DAYS` applies only to the legacy workspace integration retained for backward compatibility.
- This makes every successful registration searchable by every visitor to this deployment. Use it only for a consented, controlled group; protect the site with access control if it is not intended to be a fully public directory. Obtain the legal review, consent wording, retention policy, security controls, and incident process applicable in the deployment jurisdiction.

At startup, the upgrade moves existing face profiles into the shared directory in the same SQLite transaction that initializes the schema. The multi-sample migration also creates one sample record for every existing embedding, only when that profile has no samples yet. It is idempotent: restarts and CI/CD deployments neither recreate the database nor duplicate or delete existing profiles. This makes pre-existing profiles available from every device, matching the shared-directory setting.

## Advanced API capabilities

The server supports a controlled active-liveness challenge. Observe the limitation below.

### Important liveness limitation

The included liveness check is a real **two-frame head-pose challenge**. The site captures a baseline webcam frame, gives the subject 4 seconds to look straight briefly and then turn their head clearly left or right, then captures the second frame automatically. The default pose-delta threshold is `0.035`; it is a starting value that should be calibrated with consented test data. This generally rejects a single unchanged photo in the normal web flow, and the API does not offer a static-image bypass.

It is **not** a certified presentation-attack-detection (PAD) or anti-spoofing system. A replayed video or a sophisticated attacker can still defeat it. Do not use this challenge alone for payment, identity proofing, access control, law-enforcement, or any high-risk decision. For those uses, integrate and calibrate a dedicated PAD model, hardware-backed capture controls, rate limits, audit trails, and a human-review path.

## Run locally with Docker

Prerequisites: Docker Desktop with Docker Compose v2.

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:8000](http://localhost:8000). The health endpoint is available at [http://localhost:8000/api/health](http://localhost:8000/api/health) and the generated API documentation is at [http://localhost:8000/api/docs](http://localhost:8000/api/docs).

InsightFace model files are downloaded by InsightFace when the first real image inference occurs, then retained in the Docker `faceops-models` volume. The initial inference therefore needs outbound network access and can take longer than normal. For a production deployment, pre-warm the image with a consented test image or supply the approved model files through the persistent `/models` volume.

To stop the local service, use:

```bash
docker compose down
```

`docker compose down` keeps the named volumes and their data. To delete all local biometric data and cached models, explicitly remove the `faceops-data` and `faceops-models` volumes after confirming that this is appropriate for the environment.

### CI/CD data safety

The SQLite file is persisted in the Docker named volume mounted at `/data`; it is not part of the image and is not overwritten by `docker compose up -d --build`. Before the first CI/CD deploy, set `FACEOPS_DATA_VOLUME` in the server's `.env` or in the pipeline's protected environment variables to the **existing** data-volume name. Find it once on the server:

```bash
docker volume ls --format '{{.Name}}' | grep 'faceops-data'
```

For example, if the command shows `faceops_faceops-data`, use exactly:

```bash
FACEOPS_DATA_VOLUME=faceops_faceops-data
```

The Compose file intentionally fails if this variable is absent. This is safer than letting a CI job create a fresh empty database because its Compose project name changed. Keep the same value for every deployment. Do not run `docker compose down -v`, `docker volume rm ...`, `docker system prune --volumes`, or a CI cleanup job that removes this volume.

## Configure before public deployment

The application is deployable as a single container, but a public biometric service needs operational controls around it.

1. Set `FACEOPS_ENV=production`, replace `FACEOPS_SIGNING_SECRET` in `.env` with a long random value, and set `FACEOPS_ADMIN_TOKEN` to a different random value of at least 24 characters. The API refuses to start in production when either secret is missing or unsafe.
2. Put the container behind an HTTPS reverse proxy such as Caddy, Nginx, Cloudflare, or a managed load balancer. Use the public HTTPS URL for the page; camera access is restricted by browsers on insecure origins outside `localhost`.
3. Add request size limits, rate limits, WAF/DDoS protection, monitoring, alerting, logs that do not include raw images or tokens, and a restrictive Content Security Policy at the reverse proxy.
4. Put `/data` and `/models` on encrypted persistent storage, use managed backup policies, and set `FACEOPS_RETENTION_DAYS` to the documented retention period. Establish an administrator-only deletion process before collecting production data.
5. Keep the frontend and API on the same HTTPS origin unless you deliberately configure CORS with a small allowlist. Do not serve the repository root as static files; this project exposes only the four required frontend assets.
6. Calibrate `FACEOPS_MATCH_THRESHOLD`, `FACEOPS_POSE_DELTA_THRESHOLD`, and the enrollment quality limits with consented evaluation data from the intended camera, lighting, demographics, and use case. Their default values are starting configuration values, not universal accuracy guarantees. Do not lower `FACEOPS_MATCH_THRESHOLD` merely to increase apparent match rate; measure false accepts and false rejects first.

### Responsiveness controls

- `FACEOPS_MAX_CONCURRENT_INFERENCES=1` is the safe CPU default. It prevents several public requests from competing for the same InsightFace runtime and making every camera stream slow. Increase it only after measuring the server's CPU/GPU under real load.
- `FACEOPS_CALIBRATION_MAX_PAIRS=20000` bounds the work of the administrator-only threshold diagnostic. The normal recognition path uses one NumPy matrix multiplication for all compatible stored samples instead of a Python loop per sample.

### Scale-out note

The included SQLite database and local Docker volumes are intentionally simple and correct for one running container. Do not horizontally scale this exact configuration: separate replicas will not share the directory or embeddings. For multiple replicas, replace SQLite with PostgreSQL, use encrypted managed/object storage for model assets, add a migration strategy, and move any long-running work to a queue.

## API flow

| Endpoint | Purpose |
| --- | --- |
| `POST /api/profiles` | Registers one consented live camera face in the shared server directory. It requires `name`, `consent=true`, `mode=liveness`, one current camera frame, and the challenge baseline frame. The UI sends an in-memory `enrollment_token` only to add a further sample to a profile it just created. |
| `POST /api/recognitions` | Compares one verified live camera face with the shared server directory. |
| `POST /api/tracking` | Returns transient InsightFace face-box coordinates for the live camera overlay; it neither identifies a person nor persists images or embeddings. |
| `GET /api/profiles` | Lists shared profile metadata for an administrator only. Requires `X-Admin-Token`. |
| `GET /api/profiles/{profile_id}/details` | Returns one profile's sample metadata and full embedding vectors for an administrator only. Requires `X-Admin-Token`; it reports source images as unavailable because they are not persisted. |
| `PUT /api/profiles/{profile_id}` | Renames one shared profile for an administrator only. Requires `X-Admin-Token`. |
| `DELETE /api/profiles/{profile_id}` | Deletes one shared profile for an administrator only. Requires `X-Admin-Token`. |
| `POST /api/liveness/challenge` | Creates a one-time 90-second active-liveness challenge for one camera face. |
| `GET /api/calibration` | Calculates a non-destructive threshold diagnostic from stored samples for an administrator only. Requires `X-Admin-Token`. |
| `DELETE /api/profiles/{profile_id}/samples/{sample_id}` | Deletes one poor enrollment sample for an administrator only; the final sample is protected. Requires `X-Admin-Token`. |
| `POST /api/workspaces`, `DELETE /api/workspaces/current` | Retained only for older controlled integrations; they are not used by the public UI. |

Camera-frame requests are limited by `FACEOPS_MAX_UPLOAD_BYTES` (8 MiB by default). The server rejects invalid frames, no-face frames, and liveness requests with more than one face.

Successful `POST /api/profiles` and `POST /api/recognitions` responses include a `processing` object with measured stage durations. These durations are diagnostic information from the server process, not an accuracy or performance guarantee.

## Tests and checks

Run repository checks inside the same Python version used by Docker:

```bash
docker compose build
docker compose run --rm faceops python -m py_compile server/*.py
docker compose run --rm faceops python -m unittest discover -s tests
```

The tests cover the shared-directory boundary, legacy workspace handling, one-time liveness challenge use, and pose-change threshold logic. They deliberately do not upload or fabricate biometric images. Verify a real registration and recognition flow manually with a consented face and a camera after deployment.
