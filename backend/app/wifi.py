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


WALL_ATTENUATION_DB = 5.0      # typical drywall/brick attenuation in dB at 5GHz
WINDOW_ATTENUATION_DB = 2.0
DEFAULT_TX_DBM = 18.0          # typical indoor AP TX power
FREE_SPACE_REF_DB = 40.0       # path loss at 1m reference distance
PATH_LOSS_EXP = 3.0            # n exponent for indoor environments


def _segments_intersect(p1, p2, p3, p4) -> bool:
    """Standard segment-intersection test."""
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    return ccw(p1, p3, p4) != ccw(p2, p3, p4) and ccw(p1, p2, p3) != ccw(p1, p2, p4)


def _count_wall_crossings(ap_xy, point_xy, walls: List[Dict[str, int]]) -> int:
    count = 0
    for w in walls:
        if _segments_intersect(
            ap_xy, point_xy,
            (w["x1"], w["y1"]), (w["x2"], w["y2"]),
        ):
            count += 1
    return count


def _count_window_crossings(ap_xy, point_xy, windows: List[Dict[str, int]]) -> int:
    count = 0
    for win in windows:
        # Treat the window glyph bounding box as a thin line segment
        if _segments_intersect(
            ap_xy, point_xy,
            (win["x1"], win["y1"]), (win["x2"], win["y2"]),
        ):
            count += 1
    return count


def compute_heatmap(
    width_px: int,
    height_px: int,
    scale_m_per_px: float,
    aps: List[Dict[str, Any]],
    walls: List[Dict[str, int]],
    windows: List[Dict[str, int]] | None = None,
    grid_size: int = 60,
) -> Dict[str, Any]:
    """Return a 2D grid of best-RSSI values across the floor plan.

    aps: [{x, y, tx_dbm}]
    Returns: {grid_w, grid_h, cell_px, values: [[rssi, ...]]}
    """
    if windows is None:
        windows = []
    if not aps:
        return {"grid_w": 0, "grid_h": 0, "cell_px": 0, "values": []}

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
                # Log-distance path loss
                pl = FREE_SPACE_REF_DB + 10 * PATH_LOSS_EXP * math.log10(dist_m)
                wall_hits = _count_wall_crossings((ax, ay), (px, py), walls)
                win_hits = _count_window_crossings((ax, ay), (px, py), windows)
                rssi = tx - pl - wall_hits * WALL_ATTENUATION_DB - win_hits * WINDOW_ATTENUATION_DB
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
