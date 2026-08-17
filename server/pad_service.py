"""Per-face passive presentation-attack detection using a pinned ONNX model."""

from __future__ import annotations

import hashlib
import os
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .face_service import FaceAnalysisError, FaceObservation


@dataclass(frozen=True)
class PresentationResult:
    status: str
    live_score: float
    print_score: float
    replay_score: float
    attack_type: str | None


class PresentationAttackService:
    """Classify every detected crop as live, spoof, or uncertain in one ONNX batch."""

    def __init__(
        self,
        model_path: Path,
        model_url: str,
        model_sha256: str,
        live_threshold: float,
        spoof_threshold: float,
    ) -> None:
        self.model_path = model_path
        self.model_url = model_url
        self.model_sha256 = model_sha256.lower()
        self.live_threshold = live_threshold
        self.spoof_threshold = spoof_threshold
        self._session = None
        self._load_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._session is not None

    def ensure_model(self) -> None:
        """Download once into the persistent model volume and validate integrity."""

        if self._valid_model_file(self.model_path):
            return
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.model_path.with_suffix(self.model_path.suffix + ".download")
        try:
            with urllib.request.urlopen(self.model_url, timeout=30) as response:
                with temporary_path.open("wb") as destination:
                    while chunk := response.read(1024 * 1024):
                        destination.write(chunk)
            if not self._valid_model_file(temporary_path):
                raise RuntimeError("PAD model checksum does not match the configured SHA-256.")
            os.replace(temporary_path, self.model_path)
        except Exception as error:
            temporary_path.unlink(missing_ok=True)
            raise RuntimeError("Không tải được model PAD để xác thực người thật.") from error

    def warmup(self) -> None:
        """Load the verified model before accepting biometric API requests."""

        self._get_session()

    def classify_many(self, image_bytes: bytes, observations: list[FaceObservation]) -> list[PresentationResult]:
        if not observations:
            return []
        try:
            import cv2
        except ImportError as error:
            raise RuntimeError("OpenCV is required for PAD inference.") from error

        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise FaceAnalysisError("invalid_image", "Tệp không phải một ảnh hợp lệ.")
        batch = np.stack([self._prepare_crop(image, observation) for observation in observations])
        scores = self._predict(batch)
        return [self._result_from_scores(row) for row in scores]

    def _get_session(self):
        if self._session is not None:
            return self._session
        with self._load_lock:
            if self._session is None:
                try:
                    import onnxruntime as ort
                except ImportError as error:
                    raise RuntimeError("onnxruntime is required for PAD inference.") from error
                self.ensure_model()
                self._session = ort.InferenceSession(
                    str(self.model_path), providers=["CPUExecutionProvider"]
                )
        return self._session

    @staticmethod
    def _prepare_crop(image: np.ndarray, observation: FaceObservation) -> np.ndarray:
        if observation.bbox is None or observation.bbox.shape != (4,):
            raise FaceAnalysisError("pad_crop_unavailable", "Không thể tạo vùng kiểm tra chống giả mạo.")
        x1, y1, x2, y2 = (float(value) for value in observation.bbox)
        width = max(1.0, x2 - x1)
        height = max(1.0, y2 - y1)
        center_x = (x1 + x2) / 2
        center_y = (y1 + y2) / 2
        # MiniFASNet-V2 was trained with a 2.7x detection-box crop margin.
        side = max(width, height) * 2.7
        left = max(0, int(round(center_x - side / 2)))
        top = max(0, int(round(center_y - side / 2)))
        right = min(image.shape[1], int(round(center_x + side / 2)))
        bottom = min(image.shape[0], int(round(center_y + side / 2)))
        if right <= left or bottom <= top:
            raise FaceAnalysisError("pad_crop_unavailable", "Không thể tạo vùng kiểm tra chống giả mạo.")
        try:
            import cv2
        except ImportError as error:
            raise RuntimeError("OpenCV is required for PAD inference.") from error
        crop = cv2.resize(image[top:bottom, left:right], (80, 80), interpolation=cv2.INTER_LINEAR)
        return np.transpose(crop.astype(np.float32) / 255.0, (2, 0, 1))

    def _predict(self, batch: np.ndarray) -> np.ndarray:
        session = self._get_session()
        input_name = session.get_inputs()[0].name
        logits = np.asarray(session.run(None, {input_name: batch})[0], dtype=np.float32)
        if logits.ndim != 2 or logits.shape[1] != 3:
            raise RuntimeError("PAD model returned an unexpected output shape.")
        shifted = logits - np.max(logits, axis=1, keepdims=True)
        exponentials = np.exp(shifted)
        return exponentials / np.sum(exponentials, axis=1, keepdims=True)

    def _result_from_scores(self, scores: np.ndarray) -> PresentationResult:
        live_score, print_score, replay_score = (float(value) for value in scores)
        spoof_score = max(print_score, replay_score)
        if live_score >= self.live_threshold:
            status = "live"
            attack_type = None
        elif spoof_score >= self.spoof_threshold:
            status = "spoof"
            attack_type = "print" if print_score >= replay_score else "replay"
        else:
            status = "uncertain"
            attack_type = None
        return PresentationResult(
            status=status,
            live_score=round(live_score, 4),
            print_score=round(print_score, 4),
            replay_score=round(replay_score, 4),
            attack_type=attack_type,
        )

    def _valid_model_file(self, path: Path) -> bool:
        if not path.is_file():
            return False
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest().lower() == self.model_sha256
