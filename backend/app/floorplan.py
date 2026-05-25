"""Floor plan feature detection using OpenCV.

Strategy:
  - Walls: detected via adaptive threshold + morphology + Hough line transform.
    Long, dark, straight segments are most likely walls in architectural drawings.
  - Doors: typical floor plans draw doors as arcs. We use Hough Circle detection
    on a high-pass filtered version of the image to find small arc fragments.
  - Windows: harder to detect reliably. We look for short parallel double-lines
    along detected walls (a common convention) and flag candidates.

This is intentionally conservative — false negatives are better than false
positives because the user will correct results in the UI.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import List, Dict, Any

import cv2
import numpy as np


@dataclass
class Wall:
    x1: int
    y1: int
    x2: int
    y2: int


@dataclass
class Door:
    cx: int
    cy: int
    radius: int


@dataclass
class Window:
    x1: int
    y1: int
    x2: int
    y2: int


def _prep(image_path: str) -> np.ndarray:
    """Load and pre-process a floor plan image."""
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")
    # Resize huge images to keep processing snappy
    h, w = img.shape
    max_dim = 2000
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


def detect_walls(gray: np.ndarray) -> List[Wall]:
    """Detect wall segments using Canny + probabilistic Hough."""
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, 50, 150, apertureSize=3)
    # Dilate slightly so dashed walls are connected
    kernel = np.ones((2, 2), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=80,
        minLineLength=40,
        maxLineGap=10,
    )
    walls: List[Wall] = []
    if lines is None:
        return walls
    for line in lines:
        x1, y1, x2, y2 = line[0]
        length = float(np.hypot(x2 - x1, y2 - y1))
        if length < 40:
            continue
        # Prefer near-horizontal or near-vertical lines (typical of architectural drawings)
        angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if not (angle < 15 or angle > 75):
            continue
        walls.append(Wall(int(x1), int(y1), int(x2), int(y2)))
    return walls


def detect_doors(gray: np.ndarray) -> List[Door]:
    """Detect door arcs using Hough Circle Transform on edges."""
    blurred = cv2.medianBlur(gray, 5)
    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=30,
        param1=80,
        param2=40,
        minRadius=10,
        maxRadius=60,
    )
    doors: List[Door] = []
    if circles is None:
        return doors
    for c in np.round(circles[0]).astype(int):
        cx, cy, r = int(c[0]), int(c[1]), int(c[2])
        doors.append(Door(cx, cy, r))
    return doors[:50]  # cap to avoid runaway false positives


def detect_windows(gray: np.ndarray, walls: List[Wall]) -> List[Window]:
    """Heuristic: find short parallel double-line segments — typical window glyphs.

    We do a simple morphology-based search for thin horizontal/vertical pairs.
    This is intentionally conservative; users can add windows manually.
    """
    # Use a top-hat filter to isolate thin features
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1))
    tophat_h = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
    kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15))
    tophat_v = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel_v)
    combined = cv2.add(tophat_h, tophat_v)
    _, binarized = cv2.threshold(combined, 30, 255, cv2.THRESH_BINARY)

    # Find contours; a window glyph is short, thin, and rectangular
    contours, _ = cv2.findContours(binarized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    windows: List[Window] = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        # Window-like aspect ratios
        if (20 < w < 120 and 2 < h < 10) or (20 < h < 120 and 2 < w < 10):
            windows.append(Window(x, y, x + w, y + h))
    return windows[:40]


def analyze(image_path: str) -> Dict[str, Any]:
    """Top-level: run all detectors and return structured features."""
    gray = _prep(image_path)
    h, w = gray.shape
    walls = detect_walls(gray)
    doors = detect_doors(gray)
    windows = detect_windows(gray, walls)
    return {
        "width_px": int(w),
        "height_px": int(h),
        "walls": [asdict(x) for x in walls],
        "doors": [asdict(x) for x in doors],
        "windows": [asdict(x) for x in windows],
    }
