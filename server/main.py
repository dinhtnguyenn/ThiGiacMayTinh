"""FastAPI application serving the FaceOps frontend and real InsightFace API."""

from __future__ import annotations

import asyncio
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .calibration import threshold_report
from .config import Settings
from .database import Database, StoredProfile, Workspace
from .face_service import (
    FaceAnalysisError,
    FaceAnalysisTrace,
    FaceObservation,
    InsightFaceService,
    validate_enrollment_quality,
)
from .liveness import verify_pose_challenge


PROJECT_ROOT = Path(__file__).resolve().parents[1]
settings = Settings.from_environment()
database = Database(settings.database_path, settings.retention_days, settings.signing_secret)
face_service = InsightFaceService(settings.model_root, settings.insightface_model)
# CPU inference is intentionally serialized by default so one slow client cannot
# make every live camera stream unresponsive. Raise this only after benchmarking.
inference_semaphore = asyncio.Semaphore(settings.max_concurrent_inferences)

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


async def require_admin(
    admin_token: Annotated[str | None, Header(alias="X-Admin-Token")] = None,
) -> None:
    """Protect directory listing and mutation from public visitors."""

    if not settings.admin_token:
        api_error(503, "admin_not_configured", "Chức năng quản trị chưa được cấu hình trên máy chủ.")
    if not admin_token or not secrets.compare_digest(admin_token, settings.admin_token):
        api_error(401, "admin_auth_required", "Mã quản trị không hợp lệ.")


async def read_upload(upload: UploadFile, max_bytes: int) -> bytes:
    data = await upload.read(max_bytes + 1)
    if not data:
        api_error(422, "empty_upload", "Tệp ảnh trống.")
    if len(data) > max_bytes:
        api_error(413, "upload_too_large", "Ảnh vượt giới hạn kích thước cho phép.")
    return data


def trace_step(component: str, message: str, duration_ms: int | None = None) -> dict[str, object]:
    step: dict[str, object] = {"component": component, "message": message}
    if duration_ms is not None:
        step["duration_ms"] = duration_ms
    return step


async def analyze_image(upload: UploadFile) -> tuple[FaceObservation, list[dict[str, object]]]:
    observations, steps, _ = await analyze_faces(upload)
    if len(observations) != 1:
        api_error(
            422,
            "multiple_faces",
            "Đăng ký chỉ nhận một khuôn mặt trong khung hình để tránh lưu nhầm dữ liệu.",
        )
    return observations[0], steps


async def analyze_faces(
    upload: UploadFile,
    require_face: bool = True,
) -> tuple[list[FaceObservation], list[dict[str, object]], FaceAnalysisTrace]:
    read_started = time.perf_counter()
    image_bytes = await read_upload(upload, settings.max_upload_bytes)
    read_ms = round((time.perf_counter() - read_started) * 1000)
    queued_started = time.perf_counter()
    try:
        async with inference_semaphore:
            queue_ms = round((time.perf_counter() - queued_started) * 1000)
            observations, analysis_trace = await run_in_threadpool(face_service.analyze_many, image_bytes)
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
    if require_face and not observations:
        api_error(422, "face_not_found", "Không tìm thấy khuôn mặt trong khung hình.")
    return observations, [
        trace_step("Server", "Đã nhận và kiểm tra tệp ảnh.", read_ms),
        trace_step("Server", "Đã vào hàng đợi xử lý khuôn mặt.", queue_ms),
        trace_step("OpenCV", "Đã giải mã ảnh để InsightFace xử lý.", analysis_trace.decode_ms),
        trace_step(
            "InsightFace",
            f"Đã phát hiện {analysis_trace.face_count} khuôn mặt và tạo embedding.",
            analysis_trace.inference_ms,
        ),
    ], analysis_trace


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

    baseline_observation, _ = await analyze_image(baseline_image)
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


def profile_payload(profile: StoredProfile, sample_count: int | None = None) -> dict[str, object]:
    return {
        "id": profile.id,
        "name": profile.name,
        "source_mode": profile.source_mode,
        "created_at": as_iso(profile.created_at),
        "sample_count": len(profile.samples) if sample_count is None else sample_count,
    }


def profile_detail_payload(profile: StoredProfile) -> dict[str, object]:
    """Serialize the sensitive template only for the administrator-only endpoint."""

    return {
        "profile": profile_payload(profile),
        "raw_image_storage": {
            "stored": False,
            "message": "Ảnh gốc không được lưu trên server; chỉ embedding float32 được lưu.",
        },
        "samples": [
            {
                "id": sample.id,
                "source_mode": sample.source_mode,
                "created_at": as_iso(sample.created_at),
                "quality_score": round(sample.quality_score, 3) if sample.quality_score is not None else None,
                "embedding_dimension": sample.embedding_dim,
                "embedding_vector": np.frombuffer(sample.embedding, dtype=np.float32).tolist(),
            }
            for sample in profile.samples
        ],
    }


def bounding_box_payload(observation: FaceObservation) -> list[int]:
    """Return only display coordinates; images and embeddings remain server-side."""

    if observation.bbox is None or observation.bbox.shape != (4,):
        return [0, 0, 0, 0]
    return [round(float(value)) for value in observation.bbox]


def quality_payload(observation: FaceObservation) -> dict[str, object] | None:
    """Return numeric diagnostics only; the submitted image itself stays in memory."""

    if observation.quality is None:
        return None
    return {
        "face_width": observation.quality.width,
        "face_height": observation.quality.height,
        "detection_score": round(observation.quality.detection_score, 3),
        "brightness": round(observation.quality.brightness, 1),
        "sharpness": round(observation.quality.sharpness, 1),
        "score": round(observation.quality.score, 3),
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
async def list_profiles(
    _: Annotated[None, Depends(require_admin)],
) -> dict[str, object]:
    """Return shared directory metadata to an authenticated administrator only."""

    profiles = database.profiles_for_public_directory(include_embeddings=False)
    return {
        "profile_count": len(profiles),
        "profiles": [profile_payload(p) for p in profiles],
    }


@app.get("/api/calibration")
async def calibration_report(
    _: Annotated[None, Depends(require_admin)],
) -> dict[str, object]:
    """Calculate an on-demand threshold diagnostic; never changes production config."""

    profiles = database.profiles_for_public_directory(include_embeddings=True)
    return threshold_report(profiles, settings.match_threshold, settings.calibration_max_pairs)


@app.get("/api/profiles/{profile_id}/details")
async def get_profile_details(
    profile_id: str,
    _: Annotated[None, Depends(require_admin)],
) -> dict[str, object]:
    """Expose biometric template diagnostics to the authenticated administrator only."""

    workspace = database.public_workspace()
    profile = database.profile_for_workspace(workspace.id, profile_id, include_embeddings=True)
    if not profile:
        api_error(404, "profile_not_found", "Hồ sơ không tồn tại.")
    return profile_detail_payload(profile)

@app.delete("/api/profiles/{profile_id}", status_code=204)
async def delete_profile(
    profile_id: str,
    _: Annotated[None, Depends(require_admin)],
) -> Response:
    workspace = database.public_workspace()
    deleted = database.delete_profile(workspace.id, profile_id)
    if not deleted:
        api_error(404, "profile_not_found", "Hồ sơ không tồn tại.")
    return Response(status_code=204)


@app.delete("/api/profiles/{profile_id}/samples/{sample_id}", status_code=204)
async def delete_profile_sample(
    profile_id: str,
    sample_id: str,
    _: Annotated[None, Depends(require_admin)],
) -> Response:
    """Let an administrator discard a poor capture without deleting the identity."""

    workspace = database.public_workspace()
    result = database.delete_profile_sample(workspace.id, profile_id, sample_id)
    if result == "not_found":
        api_error(404, "sample_not_found", "Mẫu khuôn mặt không tồn tại.")
    if result == "last_sample":
        api_error(409, "last_sample_protected", "Không thể xóa mẫu cuối cùng. Hãy xóa cả hồ sơ nếu cần.")
    return Response(status_code=204)

class ProfileUpdateRequest(BaseModel):
    name: str

@app.put("/api/profiles/{profile_id}")
async def update_profile(
    profile_id: str,
    payload: ProfileUpdateRequest,
    _: Annotated[None, Depends(require_admin)],
) -> dict[str, object]:
    clean_name = " ".join(payload.name.split())
    if not clean_name or len(clean_name) > 100:
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
    enrollment_token: Annotated[str | None, Form()] = None,
) -> dict[str, object]:
    request_started = time.perf_counter()
    if not consent:
        api_error(422, "consent_required", "Cần đồng ý lưu tên và embedding khuôn mặt trên server trước khi tiếp tục.")
    clean_name = " ".join(name.split())
    if not clean_name:
        api_error(422, "invalid_name", "Tên hồ sơ không hợp lệ.")
    workspace = database.public_workspace()
    observation, processing_steps = await analyze_image(image)
    quality = validate_enrollment_quality(
        observation,
        min_face_size=settings.min_face_size,
        min_detection_score=settings.min_detection_score,
        min_sharpness=settings.min_face_sharpness,
        min_brightness=settings.min_face_brightness,
        max_brightness=settings.max_face_brightness,
    )
    processing_steps.append(trace_step("Chất lượng", "Ảnh khuôn mặt đạt điều kiện lưu mẫu."))
    liveness = await check_liveness(workspace, mode, challenge_id, baseline_image, observation)
    storage_started = time.perf_counter()
    enrollment = database.enroll_profile_sample(
        workspace.id,
        clean_name,
        mode,
        observation.embedding.astype(np.float32).tobytes(),
        int(observation.embedding.size),
        quality.score,
        settings.max_samples_per_profile,
        enrollment_token,
    )
    if enrollment is None:
        api_error(
            409,
            "profile_sample_limit_reached",
            f"Hồ sơ này đã đủ {settings.max_samples_per_profile} mẫu. Hãy dùng Quản lý dữ liệu nếu cần thay đổi.",
        )
    processing_steps.append(
        trace_step(
            "Server",
            "Đã lưu tên và embedding vào danh bạ server.",
            round((time.perf_counter() - storage_started) * 1000),
        )
    )
    return {
        "profile": profile_payload(enrollment.profile, enrollment.sample_count),
        "enrollment": {
            "created_profile": enrollment.created_profile,
            "sample_count": enrollment.sample_count,
            "max_samples": settings.max_samples_per_profile,
            "enrollment_token": enrollment.enrollment_token,
        },
        "quality": quality_payload(observation),
        "liveness": liveness,
        "processing": {
            "steps": processing_steps,
            "total_ms": round((time.perf_counter() - request_started) * 1000),
        },
    }


@app.post("/api/recognitions")
async def recognize_face(
    mode: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
    challenge_id: Annotated[str | None, Form()] = None,
    baseline_image: Annotated[UploadFile | None, File()] = None,
) -> dict[str, object]:
    request_started = time.perf_counter()
    workspace = database.public_workspace()
    observations, processing_steps, analysis_trace = await analyze_faces(image)
    if mode != "image" and len(observations) != 1:
        api_error(422, "multiple_faces", "Liveness chỉ hỗ trợ một khuôn mặt trong mỗi yêu cầu.")
    liveness = await check_liveness(workspace, mode, challenge_id, baseline_image, observations[0])
    lookup_started = time.perf_counter()
    profiles = database.profiles_for_workspace(workspace.id, include_embeddings=True)
    processing_steps.append(
        trace_step(
            "Server",
            "Đã nạp embedding đã đăng ký từ danh bạ server.",
            round((time.perf_counter() - lookup_started) * 1000),
        )
    )
    matching_started = time.perf_counter()
    samples_by_dimension: dict[int, tuple[np.ndarray, list[StoredProfile]]] = {}
    grouped_samples: dict[int, list[tuple[StoredProfile, np.ndarray]]] = {}
    for profile in profiles:
        for sample in profile.samples:
            if sample.embedding_dim <= 0:
                continue
            grouped_samples.setdefault(sample.embedding_dim, []).append(
                (profile, np.frombuffer(sample.embedding, dtype=np.float32))
            )
    for dimension, samples in grouped_samples.items():
        samples_by_dimension[dimension] = (
            np.vstack([embedding for _, embedding in samples]),
            [profile for profile, _ in samples],
        )
    recognition_faces: list[dict[str, object]] = []
    for observation in observations:
        best_profile: StoredProfile | None = None
        best_similarity = -1.0
        index = samples_by_dimension.get(int(observation.embedding.size))
        if index:
            embedding_matrix, sample_profiles = index
            best_index = int(np.argmax(embedding_matrix @ observation.embedding))
            best_similarity = float(embedding_matrix[best_index] @ observation.embedding)
            best_profile = sample_profiles[best_index]
        matched = best_profile is not None and best_similarity >= settings.match_threshold
        recognition_faces.append(
            {
                "box": bounding_box_payload(observation),
                "matched": matched,
                "similarity": round(best_similarity, 4) if best_profile is not None else None,
                "profile": profile_payload(best_profile) if matched and best_profile else None,
                "quality": quality_payload(observation),
            }
        )

    processing_steps.append(
        trace_step(
            "Server",
            f"Đã so khớp {len(observations)} embedding với danh bạ theo ngưỡng đã cấu hình.",
            round((time.perf_counter() - matching_started) * 1000),
        )
    )
    first_match = next((face for face in recognition_faces if face["matched"]), None)
    return {
        "matched": first_match is not None,
        "threshold": settings.match_threshold,
        "similarity": first_match["similarity"] if first_match else None,
        "profile": first_match["profile"] if first_match else None,
        "faces": recognition_faces,
        "image_width": analysis_trace.image_width,
        "image_height": analysis_trace.image_height,
        "reason": "no_profiles" if not profiles else "no_match",
        "liveness": liveness,
        "processing": {
            "steps": processing_steps,
            "total_ms": round((time.perf_counter() - request_started) * 1000),
        },
    }


@app.post("/api/tracking")
async def track_faces(
    image: Annotated[UploadFile, File()],
) -> dict[str, object]:
    """Return live InsightFace boxes only; tracking frames are never stored."""

    observations, _, analysis_trace = await analyze_faces(image, require_face=False)
    return {
        "image_width": analysis_trace.image_width,
        "image_height": analysis_trace.image_height,
        "faces": [{"box": bounding_box_payload(observation)} for observation in observations],
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
