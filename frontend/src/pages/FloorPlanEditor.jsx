import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const WALL_MATERIALS = [
  { id: 'concrete',        label: 'Concrete',            db: 15, color: '#888888' },
  { id: 'drywall_standard',label: 'Drywall (Standard)',  db: 3,  color: '#d0d0d0' },
  { id: 'drywall_heavy',   label: 'Drywall (Heavy Duty)',db: 4,  color: '#b0b0b0' },
  { id: 'glass_standard',  label: 'Glass (Standard)',    db: 2,  color: '#88ccff' },
  { id: 'glass_thin',      label: 'Glass (Thin)',        db: 1,  color: '#c0e8ff' },
  { id: 'brick',           label: 'Brick',               db: 5,  color: '#b84422' },
  { id: 'metal',           label: 'Metal',               db: 10, color: '#8899aa' },
  { id: 'wood',            label: 'Wood',                db: 5,  color: '#c8a060' },
];

const DOOR_MATERIALS = [
  { id: 'door_wood',  label: 'Door (Wood)',  db: 5,  color: '#c8a060' },
  { id: 'door_metal', label: 'Door (Metal)', db: 10, color: '#8899aa' },
  { id: 'door_glass', label: 'Door (Glass)', db: 2,  color: '#88ccff' },
];

const WINDOW_MATERIALS = [
  { id: 'window_single', label: 'Window (Single Pane)', db: 4,  color: '#4488ff' },
  { id: 'window_double', label: 'Window (Double Pane)', db: 7,  color: '#2266cc' },
  { id: 'window_triple', label: 'Window (Triple Pane)', db: 10, color: '#1144aa' },
];

/**
 * FloorPlanEditor
 *
 * Canvas-based editor for floor plans with WiFi heatmap overlay.
 * Zoom: scroll wheel (centered on cursor) or +/−/FIT buttons.
 * Pan: middle-mouse drag, or alt + left-drag.
 */
export default function FloorPlanEditor() {
  const { id: projectId, planId } = useParams();
  const [plan, setPlan] = useState(null);
  const [devices, setDevices] = useState([]);
  const [tool, setTool] = useState('select');
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showFeatures, setShowFeatures] = useState(true);
  const [scaleMode, setScaleMode] = useState(null);
  const [scaleLengthInput, setScaleLengthInput] = useState('');
  const [scaleUnit, setScaleUnit] = useState('m');
  const [wallMaterial, setWallMaterial] = useState(WALL_MATERIALS[0]);
  const [doorMaterial, setDoorMaterial] = useState(DOOR_MATERIALS[0]);
  const [windowMaterial, setWindowMaterial] = useState(WINDOW_MATERIALS[0]);
  const [columnShape, setColumnShape] = useState('round');

  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const drawStart = useRef(null);
  const scaleLineRef = useRef(null);
  const previewLineRef = useRef(null);
  const columnPreviewRef = useRef(null);
  const doorPreviewRef = useRef(null);
  const wallPreviewRef = useRef(null);
  const selectedRef = useRef(null);
  const dragRef = useRef(null);
  const liveOverrideRef = useRef(null);

  // Zoom / pan state (refs to avoid re-renders)
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(null);
  const drawSceneRef = useRef(null);

  useEffect(() => {
    api.getFloorplan(planId).then(setPlan);
    api.listDevices({ family: 'access_point' }).then(ds => {
      setDevices(ds);
      if (ds[0]) setSelectedDeviceId(ds[0].id);
    });
  }, [planId]);

  useEffect(() => {
    if (!plan) return;
    if ((plan.ap_placements || []).length === 0) {
      setHeatmap(null);
      return;
    }
    api.computeHeatmap(planId).then(setHeatmap).catch(() => setHeatmap(null));
  }, [JSON.stringify(plan?.ap_placements), plan?.scale_m_per_px, JSON.stringify(plan?.features), planId]);

  useEffect(() => {
    if (!plan || !imgLoaded) return;
    drawScene();
  }, [plan, heatmap, showHeatmap, showFeatures, imgLoaded, tool]);

  // Attach wheel zoom handler with passive:false so we can preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgLoaded) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZoom = Math.min(10, Math.max(0.1, zoomRef.current * factor));
      const pan = panRef.current;
      panRef.current = {
        x: mouseX - (mouseX - pan.x) * (newZoom / zoomRef.current),
        y: mouseY - (mouseY - pan.y) * (newZoom / zoomRef.current),
      };
      zoomRef.current = newZoom;
      drawSceneRef.current?.();
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [imgLoaded]);

  if (!plan) return <div style={{ color: 'var(--text-dim)' }}>Loading…</div>;

  const features = plan.features || { walls: [], doors: [], windows: [], columns: [] };

  const persist = async (patch) => {
    const updated = await api.updateFloorplan(planId, patch);
    setPlan(updated);
  };

  // ─── Canvas drawing ─────────────────────────────────────────────────────
  const drawScene = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const zoom = zoomRef.current;
    const pan = panRef.current;
    ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);

    // Floor plan image at native resolution
    ctx.drawImage(img, 0, 0);

    // Smooth heatmap overlay via offscreen canvas scaled with bilinear interpolation
    if (showHeatmap && heatmap && heatmap.values?.length) {
      const offscreen = document.createElement('canvas');
      offscreen.width = heatmap.grid_w;
      offscreen.height = heatmap.grid_h;
      const offCtx = offscreen.getContext('2d');
      const imgData = offCtx.createImageData(heatmap.grid_w, heatmap.grid_h);
      for (let j = 0; j < heatmap.grid_h; j++) {
        for (let i = 0; i < heatmap.grid_w; i++) {
          const [r, g, b, a] = rssiToRGBA(heatmap.values[j][i]);
          const idx = (j * heatmap.grid_w + i) * 4;
          imgData.data[idx]     = r;
          imgData.data[idx + 1] = g;
          imgData.data[idx + 2] = b;
          imgData.data[idx + 3] = a;
        }
      }
      offCtx.putImageData(imgData, 0, 0);
      ctx.globalAlpha = 0.55;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(offscreen, 0, 0, img.naturalWidth, img.naturalHeight);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
    }

    if (showFeatures) {
      // Walls
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(0,212,255,0.6)';
      for (let i = 0; i < (features.walls || []).length; i++) {
        const lo = liveOverrideRef.current;
        const w = (lo?.type === 'wall' && lo.index === i) ? lo.item : features.walls[i];
        const sel = selectedRef.current;
        const isSel = sel?.type === 'wall' && sel?.index === i;
        ctx.strokeStyle = isSel ? '#ffffff' : '#00d4ff';
        ctx.shadowBlur = isSel ? 0 : 4;
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
        if (isSel) {
          for (const [x, y, sp] of [[w.x1, w.y1, 'p1'], [w.x2, w.y2, 'p2']]) {
            ctx.fillStyle = sel.subpart === sp ? '#ffffff' : '#00d4ff';
            ctx.beginPath();
            ctx.arc(x, y, 6 / zoom, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.shadowBlur = 0;

      // Doors (straight lines)
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(255,176,32,0.6)';
      for (let i = 0; i < (features.doors || []).length; i++) {
        const lo = liveOverrideRef.current;
        const d = (lo?.type === 'door' && lo.index === i) ? lo.item : features.doors[i];
        if (d.x1 === undefined) continue;
        const sel = selectedRef.current;
        const isSel = sel?.type === 'door' && sel?.index === i;
        ctx.strokeStyle = isSel ? '#ffffff' : '#ffb020';
        ctx.shadowBlur = isSel ? 0 : 4;
        ctx.beginPath();
        ctx.moveTo(d.x1, d.y1);
        ctx.lineTo(d.x2, d.y2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (isSel) {
          for (const [x, y, sp] of [[d.x1, d.y1, 'p1'], [d.x2, d.y2, 'p2']]) {
            ctx.fillStyle = sel.subpart === sp ? '#ffffff' : '#ffb020';
            ctx.beginPath();
            ctx.arc(x, y, 6 / zoom, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.shadowBlur = 0;

      // Windows (dashed)
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      for (let i = 0; i < (features.windows || []).length; i++) {
        const lo = liveOverrideRef.current;
        const w = (lo?.type === 'window' && lo.index === i) ? lo.item : features.windows[i];
        const sel = selectedRef.current;
        const isSel = sel?.type === 'window' && sel?.index === i;
        ctx.strokeStyle = isSel ? '#ffffff' : '#3ddc97';
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
        if (isSel) {
          ctx.setLineDash([]);
          for (const [x, y, sp] of [[w.x1, w.y1, 'p1'], [w.x2, w.y2, 'p2']]) {
            ctx.fillStyle = sel.subpart === sp ? '#ffffff' : '#3ddc97';
            ctx.beginPath();
            ctx.arc(x, y, 6 / zoom, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.setLineDash([6, 4]);
        }
      }
      ctx.setLineDash([]);

      // Columns (round and square concrete)
      for (let i = 0; i < (features.columns || []).length; i++) {
        const lo = liveOverrideRef.current;
        const col = (lo?.type === 'column' && lo.index === i) ? lo.item : features.columns[i];
        const isSel = selectedRef.current?.type === 'column' && selectedRef.current?.index === i;
        const r = (col.size || 20) / 2;
        ctx.fillStyle = 'rgba(120,120,120,0.55)';
        ctx.strokeStyle = isSel ? '#ffffff' : '#aaaaaa';
        ctx.lineWidth = isSel ? 2.5 : 2;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        if (col.shape === 'round') {
          ctx.arc(col.cx, col.cy, r, 0, Math.PI * 2);
        } else {
          ctx.rect(col.cx - r, col.cy - r, col.size || 20, col.size || 20);
        }
        ctx.fill();
        ctx.stroke();
        if (isSel) {
          ctx.strokeStyle = '#f0b429';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          if (col.shape === 'round') {
            ctx.arc(col.cx, col.cy, r + 7, 0, Math.PI * 2);
          } else {
            ctx.rect(col.cx - r - 7, col.cy - r - 7, (col.size || 20) + 14, (col.size || 20) + 14);
          }
          ctx.stroke();
        }
      }
    }
    // Column placement preview
    const cp = columnPreviewRef.current;
    if (cp && cp.r > 2) {
      ctx.strokeStyle = '#aaaaaa';
      ctx.fillStyle = 'rgba(120,120,120,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      if (columnShape === 'round') {
        ctx.arc(cp.cx, cp.cy, cp.r, 0, Math.PI * 2);
      } else {
        ctx.rect(cp.cx - cp.r, cp.cy - cp.r, cp.r * 2, cp.r * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cp.cx - 8, cp.cy); ctx.lineTo(cp.cx + 8, cp.cy);
      ctx.moveTo(cp.cx, cp.cy - 8); ctx.lineTo(cp.cx, cp.cy + 8);
      ctx.stroke();
    }

    // APs
    for (let i = 0; i < (plan.ap_placements || []).length; i++) {
      const lo = liveOverrideRef.current;
      const ap = (lo?.type === 'ap' && lo.index === i) ? lo.item : plan.ap_placements[i];
      const isSel = selectedRef.current?.type === 'ap' && selectedRef.current?.index === i;
      const device = devices.find(d => d.id === ap.device_id);
      if (device?.coverage_radius_m) {
        const r = device.coverage_radius_m / plan.scale_m_per_px;
        ctx.beginPath();
        ctx.arc(ap.x, ap.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,212,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isSel) {
        ctx.beginPath();
        ctx.arc(ap.x, ap.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = '#f0b429';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(ap.x, ap.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#0b1220';
      ctx.fill();
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#00d4ff';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AP', ap.x, ap.y);
      if (ap.label) {
        ctx.fillStyle = '#fff';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(ap.label, ap.x, ap.y + 24);
      }
    }

    // Scale reference line
    const sl = scaleLineRef.current ?? previewLineRef.current;
    if (sl) {
      const midX = (sl.x1 + sl.x2) / 2;
      const midY = (sl.y1 + sl.y2) / 2;
      ctx.strokeStyle = '#f0b429';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(sl.x1, sl.y1);
      ctx.lineTo(sl.x2, sl.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of [[sl.x1, sl.y1], [sl.x2, sl.y2]]) {
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#f0b429';
        ctx.fill();
      }
      const pxLen = Math.round(Math.hypot(sl.x2 - sl.x1, sl.y2 - sl.y1));
      const label = `${pxLen} px`;
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(11,18,32,0.85)';
      ctx.fillRect(midX - tw / 2 - 5, midY - 11, tw + 10, 22);
      ctx.fillStyle = '#f0b429';
      ctx.fillText(label, midX, midY);
    }

    // Wall/window placement preview
    const wp = wallPreviewRef.current;
    if (wp) {
      const isWin = tool === 'window';
      ctx.strokeStyle = isWin ? 'rgba(61,220,151,0.7)' : 'rgba(0,212,255,0.7)';
      ctx.lineWidth = 3;
      if (isWin) ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(wp.x1, wp.y1);
      ctx.lineTo(wp.x2, wp.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = isWin ? '#3ddc97' : '#00d4ff';
      ctx.beginPath();
      ctx.arc(wp.x1, wp.y1, 5 / zoom, 0, Math.PI * 2);
      ctx.fill();
      if (wp.isSnapped) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / zoom;
        ctx.beginPath();
        ctx.arc(wp.x2, wp.y2, 9 / zoom, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Door placement preview
    if (tool === 'door' && drawStart.current && doorPreviewRef.current) {
      const dp = doorPreviewRef.current;
      ctx.strokeStyle = 'rgba(255,176,32,0.75)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(drawStart.current.x, drawStart.current.y);
      ctx.lineTo(dp.x, dp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(drawStart.current.x, drawStart.current.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb020';
      ctx.fill();
    }

    // Reset transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  // Keep ref current so the wheel handler always calls the latest drawScene
  drawSceneRef.current = drawScene;

  // ─── Zoom controls ───────────────────────────────────────────────────────
  const applyZoom = (factor) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const newZoom = Math.min(10, Math.max(0.1, zoomRef.current * factor));
    const pan = panRef.current;
    panRef.current = {
      x: cx - (cx - pan.x) * (newZoom / zoomRef.current),
      y: cy - (cy - pan.y) * (newZoom / zoomRef.current),
    };
    zoomRef.current = newZoom;
    drawScene();
  };

  const zoomReset = () => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    drawScene();
  };

  // ─── Hit testing ────────────────────────────────────────────────────────
  const hitTestAt = (pt) => {
    const z = zoomRef.current;
    const EP = 10 / z;  // endpoint hit radius in world coords (= 10 screen px)
    const BD = 5 / z;   // body hit radius in world coords (= 5 screen px)
    const aps = plan.ap_placements || [];
    for (let i = 0; i < aps.length; i++) {
      if (Math.hypot(pt.x - aps[i].x, pt.y - aps[i].y) < 14 / z) return true;
    }
    for (const key of ['walls', 'windows']) {
      const segs = features[key] || [];
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (Math.hypot(pt.x - s.x1, pt.y - s.y1) < EP) return true;
        if (Math.hypot(pt.x - s.x2, pt.y - s.y2) < EP) return true;
        if (distToSegment(pt, s) < BD) return true;
      }
    }
    const doors = features.doors || [];
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d.x1 !== undefined) {
        if (Math.hypot(pt.x - d.x1, pt.y - d.y1) < EP) return true;
        if (Math.hypot(pt.x - d.x2, pt.y - d.y2) < EP) return true;
        if (distToSegment(pt, d) < BD) return true;
      }
    }
    const cols = features.columns || [];
    for (let i = 0; i < cols.length; i++) {
      if (Math.hypot(pt.x - cols[i].cx, pt.y - cols[i].cy) < (cols[i].size || 20) / 2 + 6 / z) return true;
    }
    return false;
  };

  // ─── Mouse handling ─────────────────────────────────────────────────────
  const canvasCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const zoom = zoomRef.current;
    const pan = panRef.current;
    return {
      x: ((e.clientX - rect.left) * scaleX - pan.x) / zoom,
      y: ((e.clientY - rect.top) * scaleY - pan.y) / zoom,
    };
  };

  const onMouseMove = (e) => {
    // Pan (middle-mouse, alt+left, or select-tool empty-space drag)
    if (isPanningRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;
      panRef.current = {
        x: isPanningRef.current.startPan.x + (e.clientX - isPanningRef.current.startX) * scaleX,
        y: isPanningRef.current.startPan.y + (e.clientY - isPanningRef.current.startY) * scaleY,
      };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      drawScene();
      return;
    }
    // Cursor hover feedback for select tool
    if (tool === 'select' && !dragRef.current) {
      const pt = canvasCoords(e);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = hitTestAt(pt) ? 'pointer' : 'grab';
      }
    }
    if (tool === 'select' && dragRef.current) {
      if (canvasRef.current) canvasRef.current.style.cursor = 'move';
    }
    if (tool === 'scale' && drawStart.current) {
      const pt = canvasCoords(e);
      previewLineRef.current = { x1: drawStart.current.x, y1: drawStart.current.y, x2: pt.x, y2: pt.y };
      drawScene();
      return;
    }
    if (tool === 'door' && drawStart.current) {
      const pt = canvasCoords(e);
      doorPreviewRef.current = pt;
      drawScene();
      return;
    }
    if ((tool === 'wall' || tool === 'window') && drawStart.current) {
      const pt = canvasCoords(e);
      const snapped = snapToEndpoint(pt, features, zoomRef.current);
      wallPreviewRef.current = { x1: drawStart.current.x, y1: drawStart.current.y, x2: snapped.x, y2: snapped.y, isSnapped: snapped !== pt };
      drawScene();
      return;
    }
    if (tool === 'column' && drawStart.current) {
      const pt = canvasCoords(e);
      columnPreviewRef.current = { cx: drawStart.current.x, cy: drawStart.current.y, r: Math.hypot(pt.x - drawStart.current.x, pt.y - drawStart.current.y) };
      drawScene();
      return;
    }
    if (tool === 'select' && dragRef.current) {
      const pt = canvasCoords(e);
      const dr = dragRef.current;
      const dx = pt.x - dr.startX;
      const dy = pt.y - dr.startY;
      let newItem;
      if (dr.type === 'ap') {
        newItem = { ...dr.origItem, x: dr.origItem.x + dx, y: dr.origItem.y + dy };
      } else if (dr.type === 'wall' || dr.type === 'window') {
        if (dr.subpart === 'p1') {
          newItem = { ...dr.origItem, x1: dr.origItem.x1 + dx, y1: dr.origItem.y1 + dy };
        } else if (dr.subpart === 'p2') {
          newItem = { ...dr.origItem, x2: dr.origItem.x2 + dx, y2: dr.origItem.y2 + dy };
        } else {
          newItem = { ...dr.origItem, x1: dr.origItem.x1 + dx, y1: dr.origItem.y1 + dy, x2: dr.origItem.x2 + dx, y2: dr.origItem.y2 + dy };
        }
      } else if (dr.type === 'door') {
        if (dr.subpart === 'p1') {
          newItem = { ...dr.origItem, x1: dr.origItem.x1 + dx, y1: dr.origItem.y1 + dy };
        } else if (dr.subpart === 'p2') {
          newItem = { ...dr.origItem, x2: dr.origItem.x2 + dx, y2: dr.origItem.y2 + dy };
        } else {
          newItem = { ...dr.origItem, x1: dr.origItem.x1 + dx, y1: dr.origItem.y1 + dy, x2: dr.origItem.x2 + dx, y2: dr.origItem.y2 + dy };
        }
      } else if (dr.type === 'column') {
        newItem = { ...dr.origItem, cx: dr.origItem.cx + dx, cy: dr.origItem.cy + dy };
      }
      liveOverrideRef.current = { type: dr.type, index: dr.index, item: newItem };
      drawScene();
    }
  };

  const onMouseDown = (e) => {
    // Middle mouse or alt+left = pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanningRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...panRef.current } };
      e.preventDefault();
      return;
    }

    const pt = canvasCoords(e);
    if (tool === 'select') {
      const zoom = zoomRef.current;
      const EP = 10 / zoom;  // endpoint grab radius (10 screen px)
      const BD = 5 / zoom;   // body grab radius (5 screen px)
      selectedRef.current = null;
      dragRef.current = null;
      liveOverrideRef.current = null;
      const aps = plan.ap_placements || [];
      for (let i = 0; i < aps.length; i++) {
        if (Math.hypot(pt.x - aps[i].x, pt.y - aps[i].y) < 14 / zoom) {
          selectedRef.current = { type: 'ap', index: i };
          dragRef.current = { type: 'ap', index: i, startX: pt.x, startY: pt.y, origItem: { ...aps[i] } };
          if (canvasRef.current) canvasRef.current.style.cursor = 'move';
          drawScene(); return;
        }
      }
      for (const key of ['walls', 'windows']) {
        const segs = features[key] || [];
        const type = key.slice(0, -1);
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (Math.hypot(pt.x - s.x1, pt.y - s.y1) < EP) {
            selectedRef.current = { type, index: i, subpart: 'p1' };
            dragRef.current = { type, index: i, subpart: 'p1', startX: pt.x, startY: pt.y, origItem: { ...s } };
            if (canvasRef.current) canvasRef.current.style.cursor = 'move';
            drawScene(); return;
          }
          if (Math.hypot(pt.x - s.x2, pt.y - s.y2) < EP) {
            selectedRef.current = { type, index: i, subpart: 'p2' };
            dragRef.current = { type, index: i, subpart: 'p2', startX: pt.x, startY: pt.y, origItem: { ...s } };
            if (canvasRef.current) canvasRef.current.style.cursor = 'move';
            drawScene(); return;
          }
        }
      }
      for (const key of ['walls', 'windows']) {
        const segs = features[key] || [];
        const type = key.slice(0, -1);
        for (let i = 0; i < segs.length; i++) {
          if (distToSegment(pt, segs[i]) < BD) {
            selectedRef.current = { type, index: i, subpart: 'body' };
            dragRef.current = { type, index: i, subpart: 'body', startX: pt.x, startY: pt.y, origItem: { ...segs[i] } };
            if (canvasRef.current) canvasRef.current.style.cursor = 'move';
            drawScene(); return;
          }
        }
      }
      const doors = features.doors || [];
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        if (d.x1 === undefined) continue;
        if (Math.hypot(pt.x - d.x1, pt.y - d.y1) < EP) {
          selectedRef.current = { type: 'door', index: i, subpart: 'p1' };
          dragRef.current = { type: 'door', index: i, subpart: 'p1', startX: pt.x, startY: pt.y, origItem: { ...d } };
          if (canvasRef.current) canvasRef.current.style.cursor = 'move';
          drawScene(); return;
        }
        if (Math.hypot(pt.x - d.x2, pt.y - d.y2) < EP) {
          selectedRef.current = { type: 'door', index: i, subpart: 'p2' };
          dragRef.current = { type: 'door', index: i, subpart: 'p2', startX: pt.x, startY: pt.y, origItem: { ...d } };
          if (canvasRef.current) canvasRef.current.style.cursor = 'move';
          drawScene(); return;
        }
      }
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        if (d.x1 === undefined) continue;
        if (distToSegment(pt, d) < BD) {
          selectedRef.current = { type: 'door', index: i, subpart: 'body' };
          dragRef.current = { type: 'door', index: i, subpart: 'body', startX: pt.x, startY: pt.y, origItem: { ...d } };
          if (canvasRef.current) canvasRef.current.style.cursor = 'move';
          drawScene(); return;
        }
      }
      const cols = features.columns || [];
      for (let i = 0; i < cols.length; i++) {
        if (Math.hypot(pt.x - cols[i].cx, pt.y - cols[i].cy) < (cols[i].size || 20) / 2 + 6 / zoom) {
          selectedRef.current = { type: 'column', index: i };
          dragRef.current = { type: 'column', index: i, startX: pt.x, startY: pt.y, origItem: { ...cols[i] } };
          if (canvasRef.current) canvasRef.current.style.cursor = 'move';
          drawScene(); return;
        }
      }
      // Nothing hit — pan the view
      isPanningRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...panRef.current } };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      drawScene();
      return;
    } else if (tool === 'scale') {
      scaleLineRef.current = null;
      previewLineRef.current = null;
      drawStart.current = pt;
      return;
    } else if (tool === 'wall' || tool === 'window') {
      drawStart.current = snapToEndpoint(pt, features, zoomRef.current);
    } else if (tool === 'door') {
      if (!drawStart.current) {
        drawStart.current = snapToEndpoint(pt, features, zoomRef.current);
        doorPreviewRef.current = drawStart.current;
        drawScene();
      } else {
        const snappedPt = snapToEndpoint(pt, features, zoomRef.current);
        const dx = snappedPt.x - drawStart.current.x;
        const dy = snappedPt.y - drawStart.current.y;
        if (Math.hypot(dx, dy) >= 5) {
          const seg = {
            x1: Math.round(drawStart.current.x),
            y1: Math.round(drawStart.current.y),
            x2: Math.round(snappedPt.x),
            y2: Math.round(snappedPt.y),
            material: doorMaterial.id,
            attenuation_db: doorMaterial.db,
          };
          persist({ features: { ...features, doors: [...(features.doors || []), seg] } });
        }
        drawStart.current = null;
        doorPreviewRef.current = null;
        drawScene();
      }
    } else if (tool === 'column') {
      columnPreviewRef.current = null;
      drawStart.current = pt;
    } else if (tool === 'ap') {
      if (!selectedDeviceId) { alert('Pick an access point model first'); return; }
      const newAps = [...(plan.ap_placements || []), {
        device_id: selectedDeviceId, x: pt.x, y: pt.y,
        label: `AP${(plan.ap_placements || []).length + 1}`,
      }];
      persist({ ap_placements: newAps });
    } else if (tool === 'erase') {
      eraseAt(pt);
    }
  };

  const onMouseUp = (e) => {
    // End pan
    if (isPanningRef.current) {
      isPanningRef.current = null;
      if (tool === 'select' && canvasRef.current) canvasRef.current.style.cursor = 'grab';
      return;
    }
    if (tool === 'select' && dragRef.current) {
      const lo = liveOverrideRef.current;
      if (lo) {
        let patch;
        if (lo.type === 'ap') {
          patch = { ap_placements: (plan.ap_placements || []).map((a, i) => i === lo.index ? lo.item : a) };
        } else if (lo.type === 'wall') {
          patch = { features: { ...features, walls: (features.walls || []).map((s, i) => i === lo.index ? lo.item : s) } };
        } else if (lo.type === 'window') {
          patch = { features: { ...features, windows: (features.windows || []).map((s, i) => i === lo.index ? lo.item : s) } };
        } else if (lo.type === 'door') {
          patch = { features: { ...features, doors: (features.doors || []).map((d, i) => i === lo.index ? lo.item : d) } };
        } else if (lo.type === 'column') {
          patch = { features: { ...features, columns: (features.columns || []).map((c, i) => i === lo.index ? lo.item : c) } };
        }
        liveOverrideRef.current = null;
        if (patch) persist(patch);
      }
      dragRef.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = 'pointer';
      return;
    }
    if (tool === 'scale' && drawStart.current) {
      const pt = canvasCoords(e);
      const pxLen = Math.hypot(pt.x - drawStart.current.x, pt.y - drawStart.current.y);
      if (pxLen < 10) { drawStart.current = null; previewLineRef.current = null; return; }
      scaleLineRef.current = {
        x1: drawStart.current.x, y1: drawStart.current.y,
        x2: pt.x, y2: pt.y,
        pxLen,
      };
      previewLineRef.current = null;
      drawStart.current = null;
      drawScene();
      setScaleMode('dialog');
      setScaleLengthInput('');
      return;
    }
    if (tool === 'column' && drawStart.current) {
      const pt = canvasCoords(e);
      const cx = Math.round(drawStart.current.x);
      const cy = Math.round(drawStart.current.y);
      const r = Math.hypot(pt.x - drawStart.current.x, pt.y - drawStart.current.y);
      columnPreviewRef.current = null;
      drawStart.current = null;
      if (r < 5) { drawScene(); return; }
      persist({ features: { ...features, columns: [...(features.columns || []), { cx, cy, size: Math.round(r * 2), shape: columnShape, attenuation_db: 15 }] } });
      return;
    }
    if ((tool === 'wall' || tool === 'window') && drawStart.current) {
      const rawPt = canvasCoords(e);
      const pt = snapToEndpoint(rawPt, features, zoomRef.current);
      wallPreviewRef.current = null;
      const dx = pt.x - drawStart.current.x;
      const dy = pt.y - drawStart.current.y;
      if (Math.hypot(dx, dy) < 10) { drawStart.current = null; return; }
      const mat = tool === 'wall' ? wallMaterial : windowMaterial;
      const seg = {
        x1: Math.round(drawStart.current.x),
        y1: Math.round(drawStart.current.y),
        x2: Math.round(pt.x),
        y2: Math.round(pt.y),
        material: mat.id,
        attenuation_db: mat.db,
      };
      const key = tool === 'wall' ? 'walls' : 'windows';
      const newFeatures = {
        ...features,
        [key]: [...(features[key] || []), seg],
      };
      persist({ features: newFeatures });
      drawStart.current = null;
    }
  };

  const eraseAt = (pt) => {
    const z = zoomRef.current;
    const HIT = 8 / z;
    const aps = plan.ap_placements || [];
    const apIdx = aps.findIndex(ap => Math.hypot(ap.x - pt.x, ap.y - pt.y) < 14 / z);
    if (apIdx >= 0) {
      persist({ ap_placements: aps.filter((_, i) => i !== apIdx) });
      return;
    }
    const doors = features.doors || [];
    const doorIdx = doors.findIndex(d => {
      if (d.x1 !== undefined) return distToSegment(pt, d) < HIT;
      return Math.hypot(d.cx - pt.x, d.cy - pt.y) < (d.radius || 25) + 6 / z;
    });
    if (doorIdx >= 0) {
      persist({ features: { ...features, doors: doors.filter((_, i) => i !== doorIdx) } });
      return;
    }
    for (const key of ['walls', 'windows']) {
      const segs = features[key] || [];
      const segIdx = segs.findIndex(s => distToSegment(pt, s) < HIT);
      if (segIdx >= 0) {
        persist({ features: { ...features, [key]: segs.filter((_, i) => i !== segIdx) } });
        return;
      }
    }
    const columns = features.columns || [];
    const colIdx = columns.findIndex(c => Math.hypot(c.cx - pt.x, c.cy - pt.y) < (c.size || 20) / 2 + 6 / z);
    if (colIdx >= 0) {
      persist({ features: { ...features, columns: columns.filter((_, i) => i !== colIdx) } });
      return;
    }
  };

  const clearDetected = async () => {
    if (!confirm('Clear all detected walls, doors, and windows?')) return;
    persist({ features: { walls: [], doors: [], windows: [], columns: [] } });
  };

  const applyScale = () => {
    const length = parseFloat(scaleLengthInput);
    if (!length || length <= 0 || !scaleLineRef.current) return;
    const meters = scaleUnit === 'ft' ? length * 0.3048 : length;
    persist({ scale_m_per_px: meters / scaleLineRef.current.pxLen });
    scaleLineRef.current = null;
    setScaleMode(null);
    setTool('select');
  };

  const cancelScale = () => {
    scaleLineRef.current = null;
    previewLineRef.current = null;
    setScaleMode(null);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumb">/ projects / floor plan</div>
          <h1>{plan.name}</h1>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
            <span className="mono">{plan.width_px} × {plan.height_px}px</span> ·
            <span> scale {plan.scale_m_per_px} m/px</span>
          </div>
        </div>
        <Link to={`/projects/${projectId}`}><button className="ghost">← Back to Project</button></Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: '1.5rem' }}>
        {/* Sidebar */}
        <div>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>Drawing Tools</h3>
            <div className="grid g-2" style={{ gap: '6px' }}>
              {['select', 'scale', 'wall', 'door', 'window', 'column', 'ap', 'erase'].map(t => (
                <button key={t}
                        className={tool === t ? 'tool-btn active' : 'tool-btn'}
                        onClick={() => { cancelScale(); selectedRef.current = null; dragRef.current = null; liveOverrideRef.current = null; drawStart.current = null; doorPreviewRef.current = null; wallPreviewRef.current = null; setTool(t); }}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {['wall', 'door', 'window', 'column'].includes(tool) && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
                {tool === 'column' ? 'Column Options' : 'Material'}
              </h3>

              {tool === 'wall' && WALL_MATERIALS.map(m => (
                <button key={m.id} onClick={() => setWallMaterial(m)} style={{
                  display: 'flex', alignItems: 'center', width: '100%',
                  background: wallMaterial.id === m.id ? 'rgba(0,212,255,0.08)' : 'transparent',
                  border: wallMaterial.id === m.id ? '1px solid var(--border-bright)' : '1px solid transparent',
                  borderRadius: '4px', padding: '0.3rem 0.5rem', marginBottom: '2px',
                  cursor: 'pointer', color: 'var(--text)',
                }}>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: '0.82rem' }}>{m.label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginRight: '0.5rem' }}>{m.db} dB</span>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0, border: '1px solid rgba(255,255,255,0.2)' }} />
                </button>
              ))}

              {tool === 'door' && DOOR_MATERIALS.map(m => (
                <button key={m.id} onClick={() => setDoorMaterial(m)} style={{
                  display: 'flex', alignItems: 'center', width: '100%',
                  background: doorMaterial.id === m.id ? 'rgba(0,212,255,0.08)' : 'transparent',
                  border: doorMaterial.id === m.id ? '1px solid var(--border-bright)' : '1px solid transparent',
                  borderRadius: '4px', padding: '0.3rem 0.5rem', marginBottom: '2px',
                  cursor: 'pointer', color: 'var(--text)',
                }}>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: '0.82rem' }}>{m.label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginRight: '0.5rem' }}>{m.db} dB</span>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0, border: '1px solid rgba(255,255,255,0.2)' }} />
                </button>
              ))}

              {tool === 'window' && WINDOW_MATERIALS.map(m => (
                <button key={m.id} onClick={() => setWindowMaterial(m)} style={{
                  display: 'flex', alignItems: 'center', width: '100%',
                  background: windowMaterial.id === m.id ? 'rgba(0,212,255,0.08)' : 'transparent',
                  border: windowMaterial.id === m.id ? '1px solid var(--border-bright)' : '1px solid transparent',
                  borderRadius: '4px', padding: '0.3rem 0.5rem', marginBottom: '2px',
                  cursor: 'pointer', color: 'var(--text)',
                }}>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: '0.82rem' }}>{m.label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginRight: '0.5rem' }}>{m.db} dB</span>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0, border: '1px solid rgba(255,255,255,0.2)' }} />
                </button>
              ))}

              {tool === 'column' && (
                <div>
                  <div className="grid g-2" style={{ gap: '6px', marginBottom: '0.75rem' }}>
                    <button className={columnShape === 'round' ? 'tool-btn active' : 'tool-btn'}
                      onClick={() => setColumnShape('round')}>ROUND</button>
                    <button className={columnShape === 'square' ? 'tool-btn active' : 'tool-btn'}
                      onClick={() => setColumnShape('square')}>SQUARE</button>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    Click and drag to set size. Concrete · 15 dB.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ marginBottom: '1rem' }}>
            <label>Access Point Model</label>
            <select value={selectedDeviceId || ''} onChange={e => setSelectedDeviceId(parseInt(e.target.value))}>
              {devices.map(d => (
                <option key={d.id} value={d.id}>
                  {d.vendor} {d.sku} · {d.wifi_standard || 'wifi'}
                </option>
              ))}
            </select>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
              Switch to <span className="mono">AP</span> tool then click to place.
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>Display</h3>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <input type="checkbox" style={{ width: 'auto', marginRight: 8 }}
                     checked={showFeatures} onChange={e => setShowFeatures(e.target.checked)} />
              Show walls / doors / windows
            </label>
            <label style={{ display: 'block' }}>
              <input type="checkbox" style={{ width: 'auto', marginRight: 8 }}
                     checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} />
              Show WiFi heatmap
            </label>
            <div style={{ marginTop: '0.75rem' }}>
              <label>Scale (metres per pixel)</label>
              <input type="number" step="0.001" value={plan.scale_m_per_px}
                     onChange={e => persist({ scale_m_per_px: parseFloat(e.target.value) || 0.05 })} />
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>Feature Counts</h3>
            <div className="mono" style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
              <div>walls   <span style={{ float: 'right', color: 'var(--accent)' }}>{(features.walls || []).length}</span></div>
              <div>doors   <span style={{ float: 'right', color: 'var(--warn)' }}>{(features.doors || []).length}</span></div>
              <div>windows <span style={{ float: 'right', color: 'var(--ok)' }}>{(features.windows || []).length}</span></div>
              <div>columns <span style={{ float: 'right', color: '#aaaaaa' }}>{(features.columns || []).length}</span></div>
              <div>APs     <span style={{ float: 'right', color: 'var(--accent)' }}>{(plan.ap_placements || []).length}</span></div>
            </div>
            <button className="ghost" style={{ marginTop: '0.75rem', width: '100%' }} onClick={clearDetected}>
              Clear all features
            </button>
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)' }}>WiFi Legend</h3>
            <div className="legend" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem' }}>
              <div className="pill"><div className="swatch" style={{ background: rssiToColor(-40) }} /> ≥ -50 dBm · excellent</div>
              <div className="pill"><div className="swatch" style={{ background: rssiToColor(-60) }} /> -60 dBm · good</div>
              <div className="pill"><div className="swatch" style={{ background: rssiToColor(-70) }} /> -70 dBm · fair</div>
              <div className="pill"><div className="swatch" style={{ background: rssiToColor(-80) }} /> -80 dBm · weak</div>
              <div className="pill"><div className="swatch" style={{ background: rssiToColor(-95) }} /> -90 dBm · no coverage</div>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="fp-stage">
          {scaleMode === 'dialog' && scaleLineRef.current && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
              borderRadius: '8px', padding: '1.5rem', zIndex: 10,
              minWidth: '320px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}>
              <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Set Scale</h3>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '1.25rem' }}>
                Line length: <span className="mono" style={{ color: 'var(--warn)' }}>{Math.round(scaleLineRef.current.pxLen)} px</span>
              </div>
              <label>Real-world length of that line</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="number" step="0.1" min="0.1"
                  value={scaleLengthInput}
                  onChange={e => setScaleLengthInput(e.target.value)}
                  placeholder="e.g. 5"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') applyScale(); if (e.key === 'Escape') cancelScale(); }}
                  style={{ flex: 1 }}
                />
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {['m', 'ft'].map(u => (
                    <button key={u}
                      className={scaleUnit === u ? 'tool-btn active' : 'tool-btn'}
                      onClick={() => setScaleUnit(u)}
                      style={{ padding: '0.4rem 0.75rem' }}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              {scaleLengthInput && parseFloat(scaleLengthInput) > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                  → {((scaleUnit === 'ft' ? parseFloat(scaleLengthInput) * 0.3048 : parseFloat(scaleLengthInput)) / scaleLineRef.current.pxLen).toFixed(5)} m/px
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
                <button className="ghost" onClick={cancelScale}>Cancel</button>
                <button className="primary"
                  onClick={applyScale}
                  disabled={!scaleLengthInput || parseFloat(scaleLengthInput) <= 0}>
                  Apply Scale
                </button>
              </div>
            </div>
          )}
          <div className="fp-toolbar">
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', flex: 1 }}>
              Active: <span style={{ color: 'var(--accent)' }}>{tool.toUpperCase()}</span>
              {tool === 'scale' && ' · drag a line across a known distance, then enter the real-world length'}
              {tool === 'wall' && ' · click and drag to draw a wall'}
              {tool === 'door' && ' · click to start a door, click again to place it'}
              {tool === 'window' && ' · click and drag to mark a window'}
              {tool === 'ap' && ' · click to place an AP'}
              {tool === 'column' && ' · click to place a concrete column'}
              {tool === 'erase' && ' · click any feature to remove it'}
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
              <button className="tool-btn" onClick={() => applyZoom(1 / 1.25)} style={{ padding: '0.2rem 0.65rem', fontSize: '1.1rem', lineHeight: 1 }}>−</button>
              <button className="ghost" onClick={zoomReset} style={{ padding: '0.2rem 0.6rem', fontSize: '0.72rem' }}>FIT</button>
              <button className="tool-btn" onClick={() => applyZoom(1.25)} style={{ padding: '0.2rem 0.65rem', fontSize: '1.1rem', lineHeight: 1 }}>+</button>
            </div>
          </div>
          <div className="fp-canvas-wrap">
            <img ref={imgRef}
                 src={api.floorplanImageUrl(planId)}
                 alt=""
                 style={{ display: 'none' }}
                 onLoad={() => setImgLoaded(true)} />
            <canvas ref={canvasRef}
                    onMouseDown={onMouseDown}
                    onMouseUp={onMouseUp}
                    onMouseMove={onMouseMove}
                    style={{
                      width: '100%',
                      pointerEvents: scaleMode === 'dialog' ? 'none' : 'auto',
                      cursor: tool === 'select' ? 'grab' : 'crosshair',
                    }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function snapToEndpoint(pt, features, zoomLevel, screenThreshold = 15) {
  const threshold = screenThreshold / zoomLevel;
  let best = null;
  let bestDist = threshold;
  for (const key of ['walls', 'windows', 'doors']) {
    for (const seg of (features[key] || [])) {
      if (seg.x1 === undefined) continue;
      for (const ep of [{ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }]) {
        const d = Math.hypot(pt.x - ep.x, pt.y - ep.y);
        if (d < bestDist) { bestDist = d; best = ep; }
      }
    }
  }
  return best ?? pt;
}

function distToSegment(p, seg) {
  const { x1, y1, x2, y2 } = seg;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - x1, p.y - y1);
  const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
}

function rssiToColor(rssi) {
  if (rssi > -50) return 'rgb(20, 220, 90)';
  if (rssi > -60) return 'rgb(120, 220, 60)';
  if (rssi > -70) return 'rgb(220, 220, 40)';
  if (rssi > -80) return 'rgb(240, 140, 40)';
  if (rssi > -90) return 'rgb(220, 70, 70)';
  return 'rgba(80, 30, 40, 0.4)';
}

function rssiToRGBA(rssi) {
  if (rssi > -50) return [20, 220, 90, 255];
  if (rssi > -60) return [120, 220, 60, 255];
  if (rssi > -70) return [220, 220, 40, 255];
  if (rssi > -80) return [240, 140, 40, 255];
  if (rssi > -90) return [220, 70, 70, 255];
  return [80, 30, 40, 100];
}
