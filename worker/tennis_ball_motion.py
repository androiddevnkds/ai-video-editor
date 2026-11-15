#!/usr/bin/env python3
"""Detect fast, small ball-like motion tracks without a cloud API."""

import argparse
import json
import math
from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class Track:
    points: list = field(default_factory=list)
    missed: int = 0

    def add(self, frame, x, y, score):
        self.points.append((frame, float(x), float(y), float(score)))
        self.missed = 0


def estimate_net_line(frame):
    """Return perspective net line y = slope*x + intercept."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 55, 150)
    height, width = gray.shape
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=70,
                            minLineLength=width * 0.38, maxLineGap=45)
    choices = []
    if lines is not None:
        for raw in lines:
            values = np.asarray(raw).reshape(-1)
            if values.size < 4:
                continue
            x1, y1, x2, y2 = map(float, values[:4])
            if abs(x2 - x1) < width * 0.35:
                continue
            slope = (y2 - y1) / (x2 - x1)
            middle_y = (y1 + y2) / 2
            if abs(slope) > 0.28 or not height * 0.24 <= middle_y <= height * 0.58:
                continue
            intercept = y1 - slope * x1
            target_distance = abs(middle_y - height * 0.38)
            length = math.hypot(x2 - x1, y2 - y1)
            choices.append((target_distance, -length, slope, intercept))
    if not choices:
        return None
    _, _, slope, intercept = min(choices, key=lambda item: (item[0], item[1]))
    return {"slope": slope, "intercept": intercept}


def net_crossings(tracks, net, margin=10.0):
    if not net:
        return []
    crossings = []
    for track_index, track in enumerate(tracks):
        points = track["path"]
        previous = None
        for point in points:
            net_y = net["slope"] * point["x"] + net["intercept"]
            signed = point["y"] - net_y
            if abs(signed) < margin:
                continue
            side = 1 if signed > 0 else -1
            displacement = math.hypot(point["x"] - previous[1]["x"], point["y"] - previous[1]["y"]) if previous else 0
            if previous and previous[0] != side and point["time"] - previous[1]["time"] <= 0.7 and displacement >= margin * 2:
                crossings.append({
                    "time": (previous[1]["time"] + point["time"]) / 2,
                    "track": track_index,
                    "fromSide": previous[0],
                    "toSide": side,
                })
            previous = (side, point)
    return crossings


def candidates(previous, current, following, color):
    first = cv2.absdiff(previous, current)
    second = cv2.absdiff(current, following)
    # A pan/tilt moves a large portion of the image and creates hundreds of
    # false tiny blobs. Do not infer a ball on those frames.
    global_motion = max(float(np.mean(first > 11)), float(np.mean(second > 11)))
    if global_motion > 0.075:
        return []
    moving = cv2.bitwise_and(first, second)
    moving = cv2.threshold(moving, 11, 255, cv2.THRESH_BINARY)[1]
    moving = cv2.morphologyEx(moving, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    count, _, stats, centers = cv2.connectedComponentsWithStats(moving)
    found = []
    hsv = cv2.cvtColor(color, cv2.COLOR_BGR2HSV)
    height, width = current.shape
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if area < 2 or area > 75 or w > 16 or h > 16 or y < height * 0.12:
            continue
        cx, cy = centers[index]
        x0, x1 = max(0, int(cx) - 2), min(width, int(cx) + 3)
        y0, y1 = max(0, int(cy) - 2), min(height, int(cy) + 3)
        patch = hsv[y0:y1, x0:x1]
        saturation = float(np.mean(patch[:, :, 1])) if patch.size else 0
        brightness = float(np.mean(patch[:, :, 2])) if patch.size else 0
        yellow = (patch[:, :, 0] >= 18) & (patch[:, :, 0] <= 48) & (patch[:, :, 1] >= 55) & (patch[:, :, 2] >= 90)
        yellow_ratio = float(np.mean(yellow)) if patch.size else 0
        if yellow_ratio < 0.08:
            continue
        compactness = area / max(w * h, 1)
        score = compactness * 2 + brightness / 255 + saturation / 510 + yellow_ratio * 2
        found.append((float(cx), float(cy), score))
    return sorted(found, key=lambda item: item[2], reverse=True)[:80]


def link_tracks(frames, maximum_gap=3):
    active, finished = [], []
    for frame_index, detections in frames:
        unused = set(range(len(detections)))
        for track in active:
            last_frame, last_x, last_y, _ = track.points[-1]
            gap = frame_index - last_frame
            best = None
            for index in unused:
                x, y, score = detections[index]
                distance = math.hypot(x - last_x, y - last_y)
                if 1.5 <= distance <= 42 * gap and (best is None or distance < best[0]):
                    best = (distance, index)
            if best:
                _, index = best
                track.add(frame_index, *detections[index])
                unused.remove(index)
            else:
                track.missed += 1
        still_active = []
        for track in active:
            if track.missed > maximum_gap:
                finished.append(track)
            else:
                still_active.append(track)
        active = still_active
        for index in unused:
            track = Track()
            track.add(frame_index, *detections[index])
            active.append(track)
    return finished + active


def score_track(track, fps):
    if len(track.points) < 5:
        return None
    first, last = track.points[0], track.points[-1]
    span = (last[0] - first[0]) / fps
    if span <= 0:
        return None
    distances = [math.hypot(b[1] - a[1], b[2] - a[2]) for a, b in zip(track.points, track.points[1:])]
    displacement = math.hypot(last[1] - first[1], last[2] - first[2])
    average_step = float(np.mean(distances)) if distances else 0
    coverage = len(track.points) / max(1, last[0] - first[0] + 1)
    if displacement < 18 or average_step < 2.2 or coverage < 0.28:
        return None
    return {
        "start": first[0] / fps,
        "end": last[0] / fps,
        "points": len(track.points),
        "coverage": coverage,
        "displacement": displacement,
        "average_step": average_step,
        "path": [{"time": p[0] / fps, "x": p[1], "y": p[2]} for p in track.points],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--output", required=True)
    parser.add_argument("--preview")
    parser.add_argument("--width", type=int, default=512)
    args = parser.parse_args()

    capture = cv2.VideoCapture(args.video)
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 30
    frames = []
    colors = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        scale = args.width / frame.shape[1]
        resized = cv2.resize(frame, (args.width, round(frame.shape[0] * scale)))
        colors.append(resized)
        frames.append(cv2.GaussianBlur(cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY), (3, 3), 0))
    capture.release()

    detected = []
    for index in range(1, len(frames) - 1):
        detected.append((index, candidates(frames[index - 1], frames[index], frames[index + 1], colors[index])))
    tracks = [item for track in link_tracks(detected) if (item := score_track(track, source_fps))]
    tracks.sort(key=lambda item: item["points"] * item["coverage"], reverse=True)
    selected_tracks = tracks[:50]
    net = estimate_net_line(colors[0]) if colors else None
    crossings = net_crossings(selected_tracks, net)
    last_motion = max((track["end"] for track in selected_tracks), default=0)
    result = {
        "fps": source_fps,
        "width": args.width,
        "height": frames[0].shape[0] if frames else 0,
        "net": net,
        "netCrossings": crossings,
        "validRally": bool(crossings),
        "lastBallMotion": last_motion,
        "tracks": selected_tracks,
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)

    if args.preview and colors:
        preview = colors[len(colors) // 2].copy()
        for track in tracks[:20]:
            points = np.array([[round(p["x"]), round(p["y"])] for p in track["path"]], np.int32)
            if len(points) > 1:
                cv2.polylines(preview, [points], False, (0, 255, 255), 1)
        cv2.imwrite(args.preview, preview)
    print(json.dumps({"frames": len(frames), "tracks": len(tracks)}))


if __name__ == "__main__":
    main()
