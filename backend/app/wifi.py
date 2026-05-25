"""WiFi signal propagation modelling.

Uses a simplified log-distance path-loss model with additional attenuation
per wall crossing:

    RSSI(d) = Tx - 20*log10(d) - sum(wall_attenuation)

Returns a coarse grid of RSSI values which the frontend renders as a heatmap.
This isn't a full ray-tracing simulator (Ekahau-grade); it's a planning aid.
"""
from __future__ import annotations

import math
from typing import List, Dict, Any


# Per-material signal attenuation at 5 GHz (dB)
MATERIAL_ATTENUATION_DB: Dict[str, float] = {
    # Walls / partitions
    "concrete": 15.0,
    "drywall_standard": 3.0,
    "drywall_heavy": 4.0,
    "glass_standard": 2.0,
    "glass_thin": 1.0,
    "brick": 5.0,
    "metal": 10.0,
    "wood": 5.0,
    # Doors
    "door_wood": 5.0,
    "door_metal": 10.0,
    "door_glass": 2.0,
    # Windows
    "window_single": 4.0,
    "window_double": 7.0,
    "window_triple": 10.0,
}

# Fallback defaults (used when a segment has no material field)
DEFAULT_WALL_ATTENUATION_DB = 5.0
DEFAULT_WINDOW_ATTENUATION_DB = 2.0
DEFAULT_DOOR_ATTENUATION_DB = 5.0
DEFAULT_COLUMN_ATTENUATION_DB = 15.0

DEFAULT_TX_DBM = 18.0
FREE_SPACE_REF_DB = 40.0
PATH_LOSS_EXP = 3.0


def _segments_intersect(p1, p2, p3, p4) -> bool:
    """Standard segment-intersection test."""
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    return ccw(p1, p3, p4) != ccw(p2, p3, p4) and ccw(p1, p2, p3) != ccw(p1, p2, p4)


def _dist_point_to_segment(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def _sum_segment_attenuation(
    ap_xy: tuple,
    point_xy: tuple,
    segments: List[Dict],
    default_db: float,
) -> float:
    """Sum attenuation for all segments crossed by the ray from ap_xy to point_xy."""
    total = 0.0
    for seg in segments:
        if _segments_intersect(
            ap_xy, point_xy,
            (seg["x1"], seg["y1"]), (seg["x2"], seg["y2"]),
        ):
            atten = seg.get("attenuation_db") or MATERIAL_ATTENUATION_DB.get(
                seg.get("material", ""), default_db
            )
            total += atten
    return total


def _sum_column_attenuation(ap_xy: tuple, point_xy: tuple, columns: List[Dict]) -> float:
    """Add attenuation for each column whose body the ray passes through."""
    ax, ay = ap_xy
    px, py = point_xy
    total = 0.0
    for col in columns:
        cx, cy = col["cx"], col["cy"]
        r = (col.get("size") or 20) / 2
        if _dist_point_to_segment(cx, cy, ax, ay, px, py) < r:
            total += col.get("attenuation_db") or DEFAULT_COLUMN_ATTENUATION_DB
    return total


def compute_heatmap(
    width_px: int,
    height_px: int,
    scale_m_per_px: float,
    aps: List[Dict[str, Any]],
    walls: List[Dict],
    windows: List[Dict] | None = None,
    doors: List[Dict] | None = None,
    columns: List[Dict] | None = None,
    grid_size: int = 60,
) -> Dict[str, Any]:
    """Return a 2D grid of best-RSSI values across the floor plan.

    aps: [{x, y, tx_dbm}]
    Returns: {grid_w, grid_h, cell_px, values: [[rssi, ...]]}
    """
    if windows is None:
        windows = []
    if doors is None:
        doors = []
    if columns is None:
        columns = []
    if not aps:
        return {"grid_w": 0, "grid_h": 0, "cell_px": 0, "values": []}

    # Convert doors to line segments.
    # New format: {x1, y1, x2, y2} — use directly.
    # Legacy arc format: {cx, cy, radius} — use chord between arc end-points.
    door_segs: List[Dict] = []
    for d in doors:
        atten = d.get("attenuation_db") or MATERIAL_ATTENUATION_DB.get(
            d.get("material", ""), DEFAULT_DOOR_ATTENUATION_DB
        )
        if "x1" in d:
            door_segs.append({
                "x1": d["x1"], "y1": d["y1"],
                "x2": d["x2"], "y2": d["y2"],
                "attenuation_db": atten,
            })
        else:
            cx, cy, r = d["cx"], d["cy"], d.get("radius", 25)
            door_segs.append({
                "x1": cx + r, "y1": cy,
                "x2": cx,     "y2": cy + r,
                "attenuation_db": atten,
            })

    aspect = height_px / max(1, width_px)
    grid_w = grid_size
    grid_h = max(2, int(grid_size * aspect))
    cell_px = width_px / grid_w

    grid: List[List[float]] = []
    for j in range(grid_h):
        row: List[float] = []
        py = (j + 0.5) * (height_px / grid_h)
        for i in range(grid_w):
            px = (i + 0.5) * cell_px
            best = -120.0
            for ap in aps:
                ax, ay = ap["x"], ap["y"]
                tx = ap.get("tx_dbm", DEFAULT_TX_DBM)
                dx_m = (px - ax) * scale_m_per_px
                dy_m = (py - ay) * scale_m_per_px
                dist_m = math.hypot(dx_m, dy_m)
                if dist_m < 0.5:
                    dist_m = 0.5
                pl = FREE_SPACE_REF_DB + 10 * PATH_LOSS_EXP * math.log10(dist_m)
                wall_loss = _sum_segment_attenuation((ax, ay), (px, py), walls, DEFAULT_WALL_ATTENUATION_DB)
                win_loss  = _sum_segment_attenuation((ax, ay), (px, py), windows, DEFAULT_WINDOW_ATTENUATION_DB)
                door_loss = _sum_segment_attenuation((ax, ay), (px, py), door_segs, DEFAULT_DOOR_ATTENUATION_DB)
                col_loss  = _sum_column_attenuation((ax, ay), (px, py), columns)
                rssi = tx - pl - wall_loss - win_loss - door_loss - col_loss
                if rssi > best:
                    best = rssi
            row.append(round(best, 1))
        grid.append(row)

    return {
        "grid_w": grid_w,
        "grid_h": grid_h,
        "cell_px": round(cell_px, 2),
        "values": grid,
    }
