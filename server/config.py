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
    pad_model_path: Path
    pad_model_url: str
    pad_model_sha256: str
    pad_live_threshold: float
    pad_spoof_threshold: float
    retention_days: int
    match_threshold: float
    challenge_ttl_seconds: int
    pose_delta_threshold: float
    max_upload_bytes: int
    max_samples_per_profile: int
    min_face_size: int
    min_detection_score: float
    min_face_sharpness: float
    min_face_brightness: float
    max_face_brightness: float
    calibration_max_pairs: int
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
            pad_model_path=Path(
                os.getenv("FACEOPS_PAD_MODEL_PATH", str(model_root / "pad" / "minifasnet_v2.onnx"))
            ).resolve(),
            pad_model_url=os.getenv(
                "FACEOPS_PAD_MODEL_URL",
                "https://huggingface.co/garciafido/minifasnet-v2-anti-spoofing-onnx/resolve/"
                "d29c87568ca9b5662da803b10f217c4db20b142b/minifasnet_v2.onnx",
            ),
            pad_model_sha256=os.getenv(
                "FACEOPS_PAD_MODEL_SHA256",
                "d7b3cd9ba8a7ceb13baa8c4720902e27ca3112eff52f926c08804af6b6eecc7b",
            ),
            pad_live_threshold=float(os.getenv("FACEOPS_PAD_LIVE_THRESHOLD", "0.55")),
            pad_spoof_threshold=float(os.getenv("FACEOPS_PAD_SPOOF_THRESHOLD", "0.97")),
            retention_days=int(os.getenv("FACEOPS_RETENTION_DAYS", "30")),
            match_threshold=float(os.getenv("FACEOPS_MATCH_THRESHOLD", "0.45")),
            challenge_ttl_seconds=int(os.getenv("FACEOPS_CHALLENGE_TTL_SECONDS", "90")),
            pose_delta_threshold=float(os.getenv("FACEOPS_POSE_DELTA_THRESHOLD", "0.035")),
            max_upload_bytes=int(os.getenv("FACEOPS_MAX_UPLOAD_BYTES", str(8 * 1024 * 1024))),
            max_samples_per_profile=int(os.getenv("FACEOPS_MAX_SAMPLES_PER_PROFILE", "5")),
            min_face_size=int(os.getenv("FACEOPS_MIN_FACE_SIZE", "96")),
            min_detection_score=float(os.getenv("FACEOPS_MIN_DETECTION_SCORE", "0.65")),
            min_face_sharpness=float(os.getenv("FACEOPS_MIN_FACE_SHARPNESS", "35")),
            min_face_brightness=float(os.getenv("FACEOPS_MIN_FACE_BRIGHTNESS", "45")),
            max_face_brightness=float(os.getenv("FACEOPS_MAX_FACE_BRIGHTNESS", "220")),
            calibration_max_pairs=int(os.getenv("FACEOPS_CALIBRATION_MAX_PAIRS", "20000")),
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
        if self.challenge_ttl_seconds < 20:
            raise RuntimeError("FACEOPS_CHALLENGE_TTL_SECONDS must be at least 20 seconds.")
        if not 0 < self.pose_delta_threshold < 1:
            raise RuntimeError("FACEOPS_POSE_DELTA_THRESHOLD must be between 0 and 1.")
        if self.detector_size < 256 or self.detector_size > 640 or self.detector_size % 32:
            raise RuntimeError("FACEOPS_DETECTOR_SIZE must be a multiple of 32 between 256 and 640.")
        if len(self.pad_model_sha256) != 64 or any(char not in "0123456789abcdefABCDEF" for char in self.pad_model_sha256):
            raise RuntimeError("FACEOPS_PAD_MODEL_SHA256 must be a SHA-256 digest.")
        if not self.pad_model_url.startswith("https://"):
            raise RuntimeError("FACEOPS_PAD_MODEL_URL must use HTTPS.")
        if not 0 < self.pad_live_threshold < 1:
            raise RuntimeError("FACEOPS_PAD_LIVE_THRESHOLD must be between 0 and 1.")
        if not 0 < self.pad_spoof_threshold < 1:
            raise RuntimeError("FACEOPS_PAD_SPOOF_THRESHOLD must be between 0 and 1.")
        if self.pad_spoof_threshold <= self.pad_live_threshold:
            raise RuntimeError("FACEOPS_PAD_SPOOF_THRESHOLD must be greater than FACEOPS_PAD_LIVE_THRESHOLD.")
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
        if self.calibration_max_pairs < 2:
            raise RuntimeError("FACEOPS_CALIBRATION_MAX_PAIRS must be at least 2.")
        if self.max_concurrent_inferences < 1:
            raise RuntimeError("FACEOPS_MAX_CONCURRENT_INFERENCES must be at least 1.")
