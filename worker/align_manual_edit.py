#!/usr/bin/env python3
"""Align a manually edited compilation back to candidate raw videos."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def hashes(path, sample_seconds=1.0):
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps * sample_seconds))
    result = []
    frame_index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index % step == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            small = cv2.resize(gray, (17, 8), interpolation=cv2.INTER_AREA)
            bits = (small[:, 1:] > small[:, :-1]).reshape(-1)
            result.append((frame_index / fps, np.packbits(bits)))
        frame_index += 1
    capture.release()
    return result


def align(manual, raw):
    raw_times = np.array([item[0] for item in raw])
    raw_hashes = np.stack([item[1] for item in raw])
    rows = []
    previous_index = 0
    for manual_time, digest in manual:
        distances = np.unpackbits(np.bitwise_xor(raw_hashes, digest), axis=1).sum(axis=1)
        # Prefer monotonic matches, while still allowing large forward jumps at cuts.
        distances[:max(0, previous_index - 2)] += 256
        index = int(np.argmin(distances))
        rows.append({"manualTime": manual_time, "rawTime": float(raw_times[index]), "distance": int(distances[index])})
        previous_index = index
    valid = [row["distance"] for row in rows]
    return rows, float(np.median(valid)) if valid else 999


def segments(rows):
    if not rows:
        return []
    groups = [[rows[0]]]
    for row in rows[1:]:
        previous = groups[-1][-1]
        raw_delta = row["rawTime"] - previous["rawTime"]
        manual_delta = row["manualTime"] - previous["manualTime"]
        if row["distance"] <= 30 and abs(raw_delta - manual_delta) <= 2.2:
            groups[-1].append(row)
        else:
            groups.append([row])
    return [{
        "manualStart": group[0]["manualTime"],
        "manualEnd": group[-1]["manualTime"] + 1,
        "rawStart": group[0]["rawTime"],
        "rawEnd": group[-1]["rawTime"] + 1,
        "samples": len(group),
        "medianDistance": float(np.median([row["distance"] for row in group])),
    } for group in groups if len(group) >= 2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manual", type=Path)
    parser.add_argument("raw", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manual_hashes = hashes(args.manual)
    candidates = []
    for raw_path in args.raw:
        rows, median_distance = align(manual_hashes, hashes(raw_path))
        candidates.append({"raw": str(raw_path), "medianDistance": median_distance, "rows": rows})
    best = min(candidates, key=lambda item: item["medianDistance"])
    result = {
        "manual": str(args.manual),
        "matchedRaw": best["raw"],
        "medianDistance": best["medianDistance"],
        "segments": segments(best["rows"]),
        "candidateScores": [{"raw": item["raw"], "medianDistance": item["medianDistance"]} for item in candidates],
    }
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
