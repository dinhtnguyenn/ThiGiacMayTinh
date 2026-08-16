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
    retention_days: int
    match_threshold: float
    challenge_ttl_seconds: int
    pose_delta_threshold: float
    max_upload_bytes: int
    signing_secret: str
    admin_token: str

    @classmethod
    def from_environment(cls) -> "Settings":
        data_dir = Path(os.getenv("FACEOPS_DATA_DIR", "./data")).resolve()
        database_path = Path(
            os.getenv("FACEOPS_DATABASE_PATH", str(data_dir / "faceops.sqlite3"))
        ).resolve()
        return cls(
            app_env=os.getenv("FACEOPS_ENV", "development").lower(),
            data_dir=data_dir,
            database_path=database_path,
            model_root=Path(os.getenv("FACEOPS_MODEL_ROOT", "./models")).resolve(),
            insightface_model=os.getenv("FACEOPS_INSIGHTFACE_MODEL", "buffalo_l"),
            retention_days=int(os.getenv("FACEOPS_RETENTION_DAYS", "30")),
            match_threshold=float(os.getenv("FACEOPS_MATCH_THRESHOLD", "0.45")),
            challenge_ttl_seconds=int(os.getenv("FACEOPS_CHALLENGE_TTL_SECONDS", "90")),
            pose_delta_threshold=float(os.getenv("FACEOPS_POSE_DELTA_THRESHOLD", "0.06")),
            max_upload_bytes=int(os.getenv("FACEOPS_MAX_UPLOAD_BYTES", str(8 * 1024 * 1024))),
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
