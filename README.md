# FaceOps Lab

FaceOps Lab is a Vietnamese web application for registering and recognizing a face with real [InsightFace](https://github.com/deepinsight/insightface) embeddings. It serves the frontend and API from the same FastAPI process, so the browser can use it without exposing models, database credentials, or embeddings to client-side JavaScript.

## What it does

| Feature | Behavior |
| --- | --- |
| Face registration | Detects exactly one face, creates an InsightFace embedding, and stores it in the current private workspace. |
| Face recognition | Creates an embedding for the submitted frame and compares it by cosine similarity only against profiles in the same workspace. |
| Liveness mode | Requires two freshly captured webcam frames with a measurable head-pose change. The second frame is verified against the first frame. |
| Static image mode | Processes a selected image or a camera snapshot as a static image. It deliberately does not claim a liveness verdict. |
| Notebook import | Parses `.ipynb` JSON and stores only filename, nbformat, kernel name, and cell counts. It never executes a notebook or imports weights from it. |
| Workspace deletion | Deletes the workspace's profiles, liveness challenges, and notebook metadata immediately. Expired workspaces are also pruned automatically. |

## Privacy model

- A browser creates an opaque workspace token only after explicit consent. The browser keeps that token in its local storage; the server stores only a keyed HMAC-SHA-256 digest of it.
- Names and embeddings are server-side and scoped to that workspace. There is no global person search and one workspace cannot list or recognize profiles from another workspace.
- Submitted images are decoded in memory to make an embedding and are not written to the application database or file volume. Configure the reverse proxy and application logs so they do not capture request bodies, tokens, or raw images.
- The default retention period is 30 days. Change `FACEOPS_RETENTION_DAYS` before deployment to match the privacy notice and consent policy you actually use.
- This project is suitable for consented, limited-scope use. Before collecting biometric data from the public, obtain the legal review, consent wording, retention policy, security controls, and incident process applicable in the deployment jurisdiction.

## Important liveness limitation

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

## Configure before public deployment

The application is deployable as a single container, but a public biometric service needs operational controls around it.

1. Set `FACEOPS_ENV=production` and replace `FACEOPS_SIGNING_SECRET` in `.env` with a long random value. The API refuses to start in production when the development value remains.
2. Put the container behind an HTTPS reverse proxy such as Caddy, Nginx, Cloudflare, or a managed load balancer. Use the public HTTPS URL for the page; camera access is restricted by browsers on insecure origins outside `localhost`.
3. Add request size limits, rate limits, WAF/DDoS protection, monitoring, alerting, logs that do not include raw images or tokens, and a restrictive Content Security Policy at the reverse proxy.
4. Put `/data` and `/models` on encrypted persistent storage, use managed backup policies, and set `FACEOPS_RETENTION_DAYS` to the documented retention period. Test the in-product delete action as part of your release process.
5. Keep the frontend and API on the same HTTPS origin unless you deliberately configure CORS with a small allowlist. Do not serve the repository root as static files; this project exposes only the four required frontend assets.
6. Calibrate `FACEOPS_MATCH_THRESHOLD` and `FACEOPS_POSE_DELTA_THRESHOLD` with consented evaluation data from the intended camera, lighting, demographics, and use case. Their default values are starting configuration values, not universal accuracy guarantees.

### Scale-out note

The included SQLite database and local Docker volumes are intentionally simple and correct for one running container. Do not horizontally scale this exact configuration: separate replicas will not share workspace state or embeddings. For multiple replicas, replace SQLite with PostgreSQL, use encrypted managed/object storage for model assets, add a migration strategy, and move any long-running work to a queue. Preserve the workspace isolation rule in the new data layer.

## API flow

All API paths are under `/api`. Other than workspace creation and health checks, requests require:

```text
Authorization: Bearer <workspace_token>
```

| Endpoint | Purpose |
| --- | --- |
| `POST /api/workspaces` | Creates a private workspace after `{ "consent": true }`. The opaque token is returned once. |
| `POST /api/liveness/challenge` | Creates a one-time 90-second challenge for the current workspace. |
| `POST /api/profiles` | Registers one face with `name`, `mode`, `image`, and liveness fields when applicable. |
| `GET /api/profiles` | Lists profile names and metadata without embeddings. |
| `POST /api/recognitions` | Compares one submitted face with current-workspace profiles. |
| `POST /api/models/notebook` | Safely parses notebook metadata only. |
| `DELETE /api/workspaces/current` | Deletes all data for the current workspace. |

Image uploads are limited by `FACEOPS_MAX_UPLOAD_BYTES` (8 MiB by default). The server rejects invalid files, no-face images, and images with more than one face.

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

The tests cover workspace isolation, one-time liveness challenge use, and pose-change threshold logic. They deliberately do not upload or fabricate biometric images. Verify a real registration and recognition flow manually with a consented face and a camera after deployment.
