"""Environment-backed configuration for the FaceOps API."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DEVELOPMENT_SECRET = "development-only-change-this-before-public-deploy"


@dataclass(frozen=True)
class Settings:
    app_env: str
    data_dir: Path
    database_path: Path
    model_root: Path
    insightface_model: str
    detector_size: int
    retention_days: int
    match_threshold: float
    selected_profile_match_threshold: float
    max_upload_bytes: int
    max_samples_per_profile: int
    min_face_size: int
    min_detection_score: float
    min_face_sharpness: float
    min_face_brightness: float
    max_face_brightness: float
    pending_registration_ttl_seconds: int
    max_concurrent_inferences: int
    signing_secret: str
    admin_token: str

    @classmethod
    def from_environment(cls) -> "Settings":
        data_dir = Path(os.getenv("FACEOPS_DATA_DIR", "./data")).resolve()
        database_path = Path(
            os.getenv("FACEOPS_DATABASE_PATH", str(data_dir / "faceops.sqlite3"))
        ).resolve()
        model_root = Path(os.getenv("FACEOPS_MODEL_ROOT", "./models")).resolve()
        return cls(
            app_env=os.getenv("FACEOPS_ENV", "development").lower(),
            data_dir=data_dir,
            database_path=database_path,
            model_root=model_root,
            insightface_model=os.getenv("FACEOPS_INSIGHTFACE_MODEL", "buffalo_l"),
            detector_size=int(os.getenv("FACEOPS_DETECTOR_SIZE", "512")),
            retention_days=int(os.getenv("FACEOPS_RETENTION_DAYS", "30")),
            match_threshold=float(os.getenv("FACEOPS_MATCH_THRESHOLD", "0.45")),
            selected_profile_match_threshold=float(
                os.getenv("FACEOPS_SELECTED_PROFILE_MATCH_THRESHOLD", "0.55")
            ),
            max_upload_bytes=int(os.getenv("FACEOPS_MAX_UPLOAD_BYTES", str(8 * 1024 * 1024))),
            max_samples_per_profile=int(os.getenv("FACEOPS_MAX_SAMPLES_PER_PROFILE", "5")),
            min_face_size=int(os.getenv("FACEOPS_MIN_FACE_SIZE", "96")),
            min_detection_score=float(os.getenv("FACEOPS_MIN_DETECTION_SCORE", "0.65")),
            min_face_sharpness=float(os.getenv("FACEOPS_MIN_FACE_SHARPNESS", "35")),
            min_face_brightness=float(os.getenv("FACEOPS_MIN_FACE_BRIGHTNESS", "45")),
            max_face_brightness=float(os.getenv("FACEOPS_MAX_FACE_BRIGHTNESS", "220")),
            pending_registration_ttl_seconds=int(
                os.getenv("FACEOPS_PENDING_REGISTRATION_TTL_SECONDS", "300")
            ),
            max_concurrent_inferences=int(os.getenv("FACEOPS_MAX_CONCURRENT_INFERENCES", "1")),
            signing_secret=os.getenv("FACEOPS_SIGNING_SECRET", DEVELOPMENT_SECRET),
            admin_token=os.getenv("FACEOPS_ADMIN_TOKEN", ""),
        )

    def validate_for_startup(self) -> None:
        if self.app_env == "production" and self.signing_secret == DEVELOPMENT_SECRET:
            raise RuntimeError(
                "FACEOPS_SIGNING_SECRET must be set to a long random value in production."
            )
        if self.app_env == "production" and len(self.admin_token) < 24:
            raise RuntimeError(
                "FACEOPS_ADMIN_TOKEN must be at least 24 characters in production."
            )
        if self.retention_days < 1:
            raise RuntimeError("FACEOPS_RETENTION_DAYS must be at least one day.")
        if not 0 < self.match_threshold < 1:
            raise RuntimeError("FACEOPS_MATCH_THRESHOLD must be between 0 and 1.")
        if not self.match_threshold <= self.selected_profile_match_threshold < 1:
            raise RuntimeError(
                "FACEOPS_SELECTED_PROFILE_MATCH_THRESHOLD must be between "
                "FACEOPS_MATCH_THRESHOLD and 1."
            )
        if self.detector_size < 256 or self.detector_size > 640 or self.detector_size % 32:
            raise RuntimeError("FACEOPS_DETECTOR_SIZE must be a multiple of 32 between 256 and 640.")
        if self.max_samples_per_profile < 1:
            raise RuntimeError("FACEOPS_MAX_SAMPLES_PER_PROFILE must be at least 1.")
        if self.min_face_size < 32:
            raise RuntimeError("FACEOPS_MIN_FACE_SIZE must be at least 32 pixels.")
        if not 0 < self.min_detection_score <= 1:
            raise RuntimeError("FACEOPS_MIN_DETECTION_SCORE must be between 0 and 1.")
        if self.min_face_sharpness <= 0:
            raise RuntimeError("FACEOPS_MIN_FACE_SHARPNESS must be greater than 0.")
        if not 0 <= self.min_face_brightness < self.max_face_brightness <= 255:
            raise RuntimeError("Face brightness limits must be between 0 and 255 in ascending order.")
        if self.pending_registration_ttl_seconds < 30:
            raise RuntimeError("FACEOPS_PENDING_REGISTRATION_TTL_SECONDS must be at least 30 seconds.")
        if self.max_concurrent_inferences < 1:
            raise RuntimeError("FACEOPS_MAX_CONCURRENT_INFERENCES must be at least 1.")
