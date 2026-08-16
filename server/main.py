"""FastAPI application serving the FaceOps frontend and real InsightFace API."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .config import Settings
from .database import Database, StoredProfile, Workspace
from .face_service import FaceAnalysisError, FaceObservation, InsightFaceService
from .liveness import verify_pose_challenge


PROJECT_ROOT = Path(__file__).resolve().parents[1]
settings = Settings.from_environment()
database = Database(settings.database_path, settings.retention_days, settings.signing_secret)
face_service = InsightFaceService(settings.model_root, settings.insightface_model)

app = FastAPI(
    title="FaceOps API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Keep biometric API responses out of browser caches and set safe defaults."""

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


class WorkspaceRequest(BaseModel):
    consent: bool


def as_iso(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def api_error(status_code: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})


async def require_workspace(
    authorization: Annotated[str | None, Header()] = None,
) -> Workspace:
    if not authorization or not authorization.startswith("Bearer "):
        api_error(401, "workspace_auth_required", "Thiếu workspace token.")
    token = authorization.removeprefix("Bearer ").strip()
    workspace = database.workspace_for_token(token)
    if not workspace:
        api_error(401, "workspace_not_found", "Workspace đã hết hạn hoặc token không hợp lệ.")
    return workspace


async def read_upload(upload: UploadFile, max_bytes: int) -> bytes:
    data = await upload.read(max_bytes + 1)
    if not data:
        api_error(422, "empty_upload", "Tệp ảnh trống.")
    if len(data) > max_bytes:
        api_error(413, "upload_too_large", "Ảnh vượt giới hạn kích thước cho phép.")
    return data


async def analyze_image(upload: UploadFile) -> FaceObservation:
    image_bytes = await read_upload(upload, settings.max_upload_bytes)
    try:
        return await run_in_threadpool(face_service.analyze, image_bytes)
    except FaceAnalysisError as error:
        api_error(422, error.code, error.message)
    except RuntimeError:
        api_error(
            503,
            "face_engine_unavailable",
            "Face engine chưa sẵn sàng. Kiểm tra model InsightFace và thử lại sau.",
        )
    except Exception:
        api_error(
            503,
            "face_engine_unavailable",
            "Face engine gặp lỗi khi xử lý ảnh. Hãy thử lại sau.",
        )


async def check_liveness(
    workspace: Workspace,
    mode: str,
    challenge_id: str | None,
    baseline_image: UploadFile | None,
    action_observation: FaceObservation,
) -> dict[str, object]:
    if mode == "image":
        return {"status": "not_checked", "method": "static_image"}
    if mode != "liveness":
        api_error(422, "invalid_mode", "mode phải là image hoặc liveness.")
    if not challenge_id or baseline_image is None:
        api_error(422, "liveness_challenge_required", "Hoàn thành liveness challenge trước khi gửi ảnh webcam.")

    baseline_observation = await analyze_image(baseline_image)
    if not database.consume_challenge(workspace.id, challenge_id):
        api_error(422, "liveness_challenge_expired", "Challenge đã hết hạn hoặc đã được dùng. Hãy bắt đầu lại.")
    try:
        result = verify_pose_challenge(
            baseline_observation,
            action_observation,
            settings.pose_delta_threshold,
        )
    except FaceAnalysisError as error:
        api_error(422, error.code, error.message)
    return {
        "status": result.status,
        "method": result.method,
        "pose_delta": result.pose_delta,
    }


def profile_payload(profile: StoredProfile) -> dict[str, object]:
    return {
        "id": profile.id,
        "name": profile.name,
        "source_mode": profile.source_mode,
        "created_at": as_iso(profile.created_at),
    }


@app.on_event("startup")
async def startup() -> None:
    settings.validate_for_startup()
    database.initialize()


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "face_engine_loaded": face_service.loaded,
        "liveness_mode": "two_frame_pose_challenge",
    }


@app.post("/api/workspaces", status_code=201)
async def create_workspace(payload: WorkspaceRequest) -> dict[str, object]:
    if not payload.consent:
        api_error(422, "consent_required", "Cần đồng ý lưu embedding khuôn mặt trong workspace riêng trước khi tiếp tục.")
    workspace, token = database.create_workspace()
    return {
        "workspace_id": workspace.id,
        "workspace_token": token,
        "expires_at": as_iso(workspace.expires_at),
        "retention_days": settings.retention_days,
    }


@app.post("/api/liveness/challenge")
async def create_liveness_challenge(
) -> dict[str, object]:
    workspace = database.public_workspace()
    challenge = database.create_challenge(workspace.id, settings.challenge_ttl_seconds)
    return {
        "challenge_id": challenge.id,
        "instruction": "Giữ đầu thẳng trong khung hình, sau đó xoay nhẹ đầu sang trái hoặc phải và xác nhận.",
        "expires_at": as_iso(challenge.expires_at),
    }


@app.get("/api/profiles")
async def list_profiles() -> dict[str, object]:
    """Expose shared entries with names and IDs."""

    profiles = database.profiles_for_public_directory(include_embeddings=False)
    return {
        "profile_count": len(profiles),
        "profiles": [profile_payload(p) for p in profiles],
    }

@app.delete("/api/profiles/{profile_id}", status_code=204)
async def delete_profile(profile_id: str) -> Response:
    workspace = database.public_workspace()
    deleted = database.delete_profile(workspace.id, profile_id)
    if not deleted:
        api_error(404, "profile_not_found", "Hồ sơ không tồn tại.")
    return Response(status_code=204)

class ProfileUpdateRequest(BaseModel):
    name: str

@app.put("/api/profiles/{profile_id}")
async def update_profile(profile_id: str, payload: ProfileUpdateRequest) -> dict[str, object]:
    clean_name = " ".join(payload.name.split())
    if not clean_name:
        api_error(422, "invalid_name", "Tên hồ sơ không hợp lệ.")
    workspace = database.public_workspace()
    updated = database.update_profile(workspace.id, profile_id, clean_name)
    if not updated:
        api_error(404, "profile_not_found", "Hồ sơ không tồn tại.")
    return {"status": "success", "id": profile_id, "name": clean_name}


@app.post("/api/profiles", status_code=201)
async def register_profile(
    name: Annotated[str, Form(min_length=2, max_length=100)],
    consent: Annotated[bool, Form()],
    mode: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
    challenge_id: Annotated[str | None, Form()] = None,
    baseline_image: Annotated[UploadFile | None, File()] = None,
) -> dict[str, object]:
    if not consent:
        api_error(422, "consent_required", "Cần đồng ý lưu tên và embedding khuôn mặt trên server trước khi tiếp tục.")
    clean_name = " ".join(name.split())
    if not clean_name:
        api_error(422, "invalid_name", "Tên hồ sơ không hợp lệ.")
    workspace = database.public_workspace()
    observation = await analyze_image(image)
    liveness = await check_liveness(workspace, mode, challenge_id, baseline_image, observation)
    profile = database.add_profile(
        workspace.id,
        clean_name,
        mode,
        observation.embedding.astype(np.float32).tobytes(),
        int(observation.embedding.size),
    )
    return {"profile": profile_payload(profile), "liveness": liveness}


@app.post("/api/recognitions")
async def recognize_face(
    mode: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
    challenge_id: Annotated[str | None, Form()] = None,
    baseline_image: Annotated[UploadFile | None, File()] = None,
) -> dict[str, object]:
    workspace = database.public_workspace()
    observation = await analyze_image(image)
    liveness = await check_liveness(workspace, mode, challenge_id, baseline_image, observation)
    profiles = database.profiles_for_workspace(workspace.id, include_embeddings=True)
    if not profiles:
        return {"matched": False, "reason": "no_profiles", "liveness": liveness}

    best_profile: StoredProfile | None = None
    best_similarity = -1.0
    for profile in profiles:
        if profile.embedding_dim != observation.embedding.size:
            continue
        candidate = np.frombuffer(profile.embedding, dtype=np.float32)
        similarity = float(np.dot(observation.embedding, candidate))
        if similarity > best_similarity:
            best_similarity = similarity
            best_profile = profile

    if best_profile is None:
        return {"matched": False, "reason": "embedding_schema_mismatch", "liveness": liveness}
    matched = best_similarity >= settings.match_threshold
    return {
        "matched": matched,
        "threshold": settings.match_threshold,
        "similarity": round(best_similarity, 4),
        "profile": profile_payload(best_profile) if matched else None,
        "liveness": liveness,
    }


@app.post("/api/models/notebook", status_code=201)
async def import_notebook(
    workspace: Annotated[Workspace, Depends(require_workspace)],
    notebook: Annotated[UploadFile, File()],
) -> dict[str, object]:
    filename = Path(notebook.filename or "").name
    if not filename.lower().endswith(".ipynb"):
        api_error(422, "invalid_notebook", "Chỉ nhận tệp .ipynb.")
    content = await read_upload(notebook, min(settings.max_upload_bytes, 2 * 1024 * 1024))
    try:
        parsed = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        api_error(422, "invalid_notebook", "Tệp không phải JSON Jupyter hợp lệ.")
    cells = parsed.get("cells") if isinstance(parsed, dict) else None
    if not isinstance(cells, list):
        api_error(422, "invalid_notebook", "Notebook không có danh sách cells hợp lệ.")
    metadata = parsed.get("metadata", {}) if isinstance(parsed.get("metadata", {}), dict) else {}
    kernelspec = metadata.get("kernelspec", {}) if isinstance(metadata.get("kernelspec", {}), dict) else {}
    code_cells = sum(cell.get("cell_type") == "code" for cell in cells if isinstance(cell, dict))
    markdown_cells = sum(cell.get("cell_type") == "markdown" for cell in cells if isinstance(cell, dict))
    notebook_id = database.add_notebook(
        workspace.id,
        filename,
        str(parsed.get("nbformat", "unknown")),
        code_cells,
        markdown_cells,
        str(kernelspec.get("name")) if kernelspec.get("name") else None,
    )
    return {
        "id": notebook_id,
        "filename": filename,
        "nbformat": str(parsed.get("nbformat", "unknown")),
        "code_cells": code_cells,
        "markdown_cells": markdown_cells,
        "kernel_name": kernelspec.get("name"),
        "execution": "not_run",
        "notice": "Notebook được kiểm tra metadata, không thực thi code hoặc nạp trọng số từ .ipynb.",
    }


@app.delete("/api/workspaces/current", status_code=204)
async def delete_current_workspace(
    workspace: Annotated[Workspace, Depends(require_workspace)],
) -> Response:
    database.delete_workspace(workspace.id)
    return Response(status_code=204)


def frontend_file(filename: str, media_type: str) -> FileResponse:
    return FileResponse(PROJECT_ROOT / filename, media_type=media_type)


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
async def frontend_index() -> FileResponse:
    return frontend_file("index.html", "text/html")


@app.get("/app.js", include_in_schema=False)
async def frontend_javascript() -> FileResponse:
    return frontend_file("app.js", "application/javascript")


@app.get("/styles.css", include_in_schema=False)
async def frontend_styles() -> FileResponse:
    return frontend_file("styles.css", "text/css")


@app.get("/tokens.css", include_in_schema=False)
async def frontend_tokens() -> FileResponse:
    return frontend_file("tokens.css", "text/css")
