"""Offline threshold diagnostics from already-consented enrollment samples."""

from __future__ import annotations

from itertools import combinations

import numpy as np

from .database import StoredProfile


def threshold_report(
    profiles: list[StoredProfile], current_threshold: float, max_pairs: int = 20_000
) -> dict[str, object]:
    """Estimate a useful threshold without changing the running configuration.

    Same-profile pairs are treated as genuine comparisons; cross-profile pairs are
    treated as impostor comparisons. This is an operational diagnostic, not a
    substitute for a consented, independently labelled evaluation set.
    """

    vectors: list[tuple[str, int, np.ndarray]] = []
    positives: list[float] = []
    for profile in profiles:
        if len(positives) >= max_pairs:
            break
        samples = [
            (sample.embedding_dim, np.frombuffer(sample.embedding, dtype=np.float32))
            for sample in profile.samples
            if sample.embedding_dim > 0
        ]
        vectors.extend((profile.id, dimension, sample) for dimension, sample in samples)
        for (first_dimension, first), (second_dimension, second) in combinations(samples, 2):
            if first_dimension != second_dimension:
                continue
            positives.append(float(np.dot(first, second)))
            if len(positives) >= max_pairs:
                break

    negatives: list[float] = []
    for (first_id, first_dimension, first), (second_id, second_dimension, second) in combinations(vectors, 2):
        if first_id == second_id or first_dimension != second_dimension:
            continue
        negatives.append(float(np.dot(first, second)))
        if len(negatives) >= max_pairs:
            break

    result: dict[str, object] = {
        "current_threshold": current_threshold,
        "genuine_pairs": len(positives),
        "impostor_pairs": len(negatives),
        "pair_limit": max_pairs,
        "ready": len(positives) >= 2 and len(negatives) >= 2,
    }
    if not result["ready"]:
        result["notice"] = "Cần ít nhất hai cặp cùng người và hai cặp khác người để đề xuất ngưỡng."
        return result

    positive_array = np.asarray(positives, dtype=np.float32)
    negative_array = np.asarray(negatives, dtype=np.float32)
    candidates = np.unique(np.concatenate((positive_array, negative_array, [current_threshold])))
    best: tuple[float, float, float, float] | None = None
    for threshold in candidates:
        far = float(np.mean(negative_array >= threshold))
        frr = float(np.mean(positive_array < threshold))
        candidate = (abs(far - frr), far + frr, float(threshold), far)
        if best is None or candidate < best:
            best = candidate
            best_frr = frr
    assert best is not None
    _, _, recommended, far = best
    result.update(
        {
            "recommended_threshold": round(recommended, 4),
            "estimated_far": round(far, 4),
            "estimated_frr": round(best_frr, 4),
            "notice": "Chỉ là ước lượng từ mẫu đã đăng ký; hãy hiệu chỉnh lại bằng tập dữ liệu có nhãn trước khi đổi cấu hình production.",
        }
    )
    return result
