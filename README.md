# FaceOps Lab

FaceOps Lab is a Vietnamese web application for registering and recognizing a face with real [InsightFace](https://github.com/deepinsight/insightface) embeddings. It serves the frontend and API from the same FastAPI process, so the browser can use it without exposing models, database credentials, or embeddings to client-side JavaScript.

## What it does

| Feature | Behavior |
| --- | --- |
| Face registration | The user enters a name, opens the webcam, and saves one detected face as an InsightFace embedding on the server. |
| Face recognition | Any device using the same deployed website can identify a face registered on the server. The app shows the stored name for a match, or `Chưa có dữ liệu` when there is not. |
| Client storage | The public registration and recognition flow stores neither a workspace token nor face embeddings in browser storage. |

## User interface

The website has three modules:

1. **Đăng ký** — the page asks for camera permission when it opens. Enter a name and select **Đăng ký khuôn mặt**; the app opens the camera automatically if no image was selected. A success message remains on this tab. Registration accepts exactly one face to avoid assigning a name to the wrong person.
2. **Nhận diện** — the camera opens automatically when this tab is selected. Use a fresh webcam frame or one uploaded image, then select **Nhận diện**. A single image may contain multiple people; each detected face receives its own `Đã tìm thấy dữ liệu` or `Chưa có dữ liệu` result.
3. **Quản lý dữ liệu** — enter the server administrator token to view the directory, rename a profile, or delete one. The token is kept only in the tab's memory and is never written to browser storage.

The simple UI sends either a fresh webcam frame or one selected image in static-image mode. It does not expose the former liveness or notebook controls. While a camera is live, the browser periodically submits an in-memory frame to InsightFace and draws the returned face boxes as tracking overlays. These tracking frames are not stored. After each registration or recognition, the processing trace is available on demand. The trace never includes raw images, embeddings, filesystem paths, or administrator tokens.

## Shared server storage

- The simple website uses one shared server-side directory. A face registered from device A can be recognized from device B, as long as both devices use the same deployed website and database.
- The browser does not store a face embedding, image, profile, or workspace token. The SQLite database in the server's persistent `/data` volume stores the name and InsightFace embedding.
- Public recognition requests do not return a list of registered names. A name is returned only after a submitted face reaches the configured match threshold; the administrator-only management API is the sole exception.
- Directory administration is protected by `FACEOPS_ADMIN_TOKEN`. It is required for `GET`, `PUT`, and `DELETE` requests to `/api/profiles`; public visitors cannot list, rename, or delete profiles.
- Submitted images are decoded in memory to make an embedding and are not written to the application database or file volume. Configure the reverse proxy and application logs so they do not capture request bodies, tokens, or raw images.
- Shared profiles are retained in the server database until an administrator deliberately removes them. `FACEOPS_RETENTION_DAYS` applies only to the legacy workspace integration retained for backward compatibility.
- This makes every successful registration searchable by every visitor to this deployment. Use it only for a consented, controlled group; protect the site with access control if it is not intended to be a fully public directory. Obtain the legal review, consent wording, retention policy, security controls, and incident process applicable in the deployment jurisdiction.

At startup, the upgrade moves existing face profiles and notebook metadata from legacy workspaces into the shared directory in the same SQLite transaction that initializes the schema. It does not recreate the database, delete profiles, or copy raw images. This makes pre-existing profiles available from every device, matching the shared-directory setting.

## Advanced API capabilities

The server retains optional liveness and notebook-inspection endpoints for controlled integrations, but the streamlined public UI does not expose them. If a separate client uses the liveness API, observe the limitation below.

### Important liveness limitation

The included liveness check is a real **two-frame head-pose challenge**: capture a baseline webcam frame, turn the head slightly left or right, then submit a second webcam frame. It generally rejects a single unchanged photo in the normal web flow.

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
6. Calibrate `FACEOPS_MATCH_THRESHOLD` and `FACEOPS_POSE_DELTA_THRESHOLD` with consented evaluation data from the intended camera, lighting, demographics, and use case. Their default values are starting configuration values, not universal accuracy guarantees.

### Scale-out note

The included SQLite database and local Docker volumes are intentionally simple and correct for one running container. Do not horizontally scale this exact configuration: separate replicas will not share the directory or embeddings. For multiple replicas, replace SQLite with PostgreSQL, use encrypted managed/object storage for model assets, add a migration strategy, and move any long-running work to a queue.

## API flow

| Endpoint | Purpose |
| --- | --- |
| `POST /api/profiles` | Registers one consented face in the shared server directory. Requires `name`, `consent=true`, `mode`, `image`, and liveness fields when applicable. |
| `POST /api/recognitions` | Compares every detected face in one submitted image with the shared server directory. |
| `POST /api/tracking` | Returns transient InsightFace face-box coordinates for the live camera overlay; it does not persist images or embeddings. |
| `GET /api/profiles` | Lists shared profile metadata for an administrator only. Requires `X-Admin-Token`. |
| `PUT /api/profiles/{profile_id}` | Renames one shared profile for an administrator only. Requires `X-Admin-Token`. |
| `DELETE /api/profiles/{profile_id}` | Deletes one shared profile for an administrator only. Requires `X-Admin-Token`. |
| `POST /api/liveness/challenge` | Creates a one-time 90-second challenge for the shared directory flow. |
| `POST /api/workspaces`, `POST /api/models/notebook`, `DELETE /api/workspaces/current` | Retained only for older controlled integrations; they are not used by the public UI. |

Image uploads are limited by `FACEOPS_MAX_UPLOAD_BYTES` (8 MiB by default). The server rejects invalid files, no-face images, and images with more than one face.

Successful `POST /api/profiles` and `POST /api/recognitions` responses include a `processing` object with measured stage durations. These durations are diagnostic information from the server process, not an accuracy or performance guarantee.

## Notebook and custom models

An `.ipynb` file is source material, not a deployed model. This application never runs notebook cells and cannot load weights from a notebook. A custom face-recognition model requires a separate, reviewed deployment pipeline for an actual artifact such as `.onnx` or `.pth`, including:

- a malware and provenance review;
- an explicit model registry and version metadata;
- compatibility tests for embedding dimensionality and preprocessing;
- validation and threshold calibration before the model receives public biometric data.

Do not add direct execution of uploaded notebooks to a public service.

## Tests and checks

Run repository checks inside the same Python version used by Docker:

```bash
docker compose build
docker compose run --rm faceops python -m py_compile server/*.py
docker compose run --rm faceops python -m unittest discover -s tests
```

The tests cover the shared-directory boundary, legacy workspace handling, one-time liveness challenge use, and pose-change threshold logic. They deliberately do not upload or fabricate biometric images. Verify a real registration and recognition flow manually with a consented face and a camera after deployment.
