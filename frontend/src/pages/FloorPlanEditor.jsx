import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

/**
 * FloorPlanEditor
 *
 * A canvas-based editor that overlays detected and user-drawn features on top
 * of the uploaded floor plan image. Tools:
 *   - select : pan + edit existing items
 *   - wall   : click-drag to draw a wall segment
 *   - door   : click to place a door marker
 *   - window : click-drag to mark a window (thin segment)
 *   - ap     : click to drop an access point (choose from devices first)
 *   - erase  : click an item to delete it
 *
 * The heatmap is requested from the backend whenever AP positions change.
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
  const [scaleMode, setScaleMode] = useState(null); // null | 'dialog'
  const [scaleLengthInput, setScaleLengthInput] = useState('');
  const [scaleUnit, setScaleUnit] = useState('m');

  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const drawStart = useRef(null);
  const scaleLineRef = useRef(null);    // finalized scale reference line
  const previewLineRef = useRef(null);  // live preview while dragging
  const selectedRef = useRef(null);     // { type, index, subpart? }
  const dragRef = useRef(null);         // { type, index, subpart, startX, startY, origItem }
  const liveOverrideRef = useRef(null); // { type, index, item } live position during drag

  // Load plan + APs
  useEffect(() => {
    api.getFloorplan(planId).then(setPlan);
    api.listDevices({ family: 'access_point' }).then(ds => {
      setDevices(ds);
      if (ds[0]) setSelectedDeviceId(ds[0].id);
    });
  }, [planId]);

  // Recompute heatmap when APs change
  useEffect(() => {
    if (!plan) return;
    if ((plan.ap_placements || []).length === 0) {
      setHeatmap(null);
      return;
    }
    api.computeHeatmap(planId).then(setHeatmap).catch(() => setHeatmap(null));
  }, [plan?.ap_placements?.length, planId]);

  // Re-render canvas whenever state changes
  useEffect(() => {
    if (!plan || !imgLoaded) return;
    drawScene();
  }, [plan, heatmap, showHeatmap, showFeatures, imgLoaded, tool]);

  if (!plan) return <div style={{ color: 'var(--text-dim)' }}>Loading…</div>;

  const features = plan.features || { walls: [], doors: [], windows: [] };

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

    // Floor plan image at native resolution
    ctx.drawImage(img, 0, 0);

    // Heatmap overlay
    if (showHeatmap && heatmap && heatmap.values?.length) {
      const cellW = canvas.width / heatmap.grid_w;
      const cellH = canvas.height / heatmap.grid_h;
      ctx.globalAlpha = 0.55;
      for (let j = 0; j < heatmap.grid_h; j++) {
        for (let i = 0; i < heatmap.grid_w; i++) {
          const rssi = heatmap.values[j][i];
          ctx.fillStyle = rssiToColor(rssi);
          ctx.fillRect(i * cellW, j * cellH, cellW + 1, cellH + 1);
        }
      }
      ctx.globalAlpha = 1;
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
            ctx.fillRect(x - 6, y - 6, 12, 12);
          }
        }
      }
      ctx.shadowBlur = 0;

      // Doors (arcs)
      ctx.lineWidth = 2.5;
      for (let i = 0; i < (features.doors || []).length; i++) {
        const lo = liveOverrideRef.current;
        const d = (lo?.type === 'door' && lo.index === i) ? lo.item : features.doors[i];
        const isSel = selectedRef.current?.type === 'door' && selectedRef.current?.index === i;
        ctx.strokeStyle = isSel ? '#ffffff' : '#ffb020';
        ctx.beginPath();
        ctx.arc(d.cx, d.cy, d.radius, 0, Math.PI / 2);
        ctx.stroke();
        if (isSel) {
          ctx.strokeStyle = '#f0b429';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(d.cx, d.cy, d.radius + 7, 0, Math.PI / 2);
          ctx.stroke();
          ctx.lineWidth = 2.5;
        }
      }

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
            ctx.fillRect(x - 6, y - 6, 12, 12);
          }
          ctx.setLineDash([6, 4]);
        }
      }
      ctx.setLineDash([]);
    }

    // APs
    for (let i = 0; i < (plan.ap_placements || []).length; i++) {
      const lo = liveOverrideRef.current;
      const ap = (lo?.type === 'ap' && lo.index === i) ? lo.item : plan.ap_placements[i];
      const isSel = selectedRef.current?.type === 'ap' && selectedRef.current?.index === i;
      const device = devices.find(d => d.id === ap.device_id);
      // Coverage ring (translucent)
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
      // Selection ring
      if (isSel) {
        ctx.beginPath();
        ctx.arc(ap.x, ap.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = '#f0b429';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // AP marker
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

    // Scale reference line (finalized or live preview)
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
  };

  // ─── Mouse handling ─────────────────────────────────────────────────────
  const canvasCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const onMouseMove = (e) => {
    if (tool === 'scale' && drawStart.current) {
      const pt = canvasCoords(e);
      previewLineRef.current = { x1: drawStart.current.x, y1: drawStart.current.y, x2: pt.x, y2: pt.y };
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
        newItem = { ...dr.origItem, cx: dr.origItem.cx + dx, cy: dr.origItem.cy + dy };
      }
      liveOverrideRef.current = { type: dr.type, index: dr.index, item: newItem };
      drawScene();
    }
  };

  const onMouseDown = (e) => {
    const pt = canvasCoords(e);
    if (tool === 'select') {
      selectedRef.current = null;
      dragRef.current = null;
      liveOverrideRef.current = null;
      const aps = plan.ap_placements || [];
      // APs
      for (let i = 0; i < aps.length; i++) {
        if (Math.hypot(pt.x - aps[i].x, pt.y - aps[i].y) < 18) {
          selectedRef.current = { type: 'ap', index: i };
          dragRef.current = { type: 'ap', index: i, startX: pt.x, startY: pt.y, origItem: { ...aps[i] } };
          drawScene(); return;
        }
      }
      // Wall/window endpoints (higher priority than body)
      for (const key of ['walls', 'windows']) {
        const segs = features[key] || [];
        const type = key.slice(0, -1);
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (Math.hypot(pt.x - s.x1, pt.y - s.y1) < 12) {
            selectedRef.current = { type, index: i, subpart: 'p1' };
            dragRef.current = { type, index: i, subpart: 'p1', startX: pt.x, startY: pt.y, origItem: { ...s } };
            drawScene(); return;
          }
          if (Math.hypot(pt.x - s.x2, pt.y - s.y2) < 12) {
            selectedRef.current = { type, index: i, subpart: 'p2' };
            dragRef.current = { type, index: i, subpart: 'p2', startX: pt.x, startY: pt.y, origItem: { ...s } };
            drawScene(); return;
          }
        }
      }
      // Wall/window body
      for (const key of ['walls', 'windows']) {
        const segs = features[key] || [];
        const type = key.slice(0, -1);
        for (let i = 0; i < segs.length; i++) {
          if (distToSegment(pt, segs[i]) < 12) {
            selectedRef.current = { type, index: i, subpart: 'body' };
            dragRef.current = { type, index: i, subpart: 'body', startX: pt.x, startY: pt.y, origItem: { ...segs[i] } };
            drawScene(); return;
          }
        }
      }
      // Doors
      const doors = features.doors || [];
      for (let i = 0; i < doors.length; i++) {
        if (Math.hypot(pt.x - doors[i].cx, pt.y - doors[i].cy) < doors[i].radius + 8) {
          selectedRef.current = { type: 'door', index: i };
          dragRef.current = { type: 'door', index: i, startX: pt.x, startY: pt.y, origItem: { ...doors[i] } };
          drawScene(); return;
        }
      }
      drawScene(); // nothing hit — deselect
      return;
    } else if (tool === 'scale') {
      scaleLineRef.current = null;
      previewLineRef.current = null;
      drawStart.current = pt;
      return;
    } else if (tool === 'wall' || tool === 'window') {
      drawStart.current = pt;
    } else if (tool === 'door') {
      const newFeatures = {
        ...features,
        doors: [...(features.doors || []), { cx: pt.x, cy: pt.y, radius: 25 }],
      };
      persist({ features: newFeatures });
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
        }
        liveOverrideRef.current = null;
        if (patch) persist(patch);
      }
      dragRef.current = null;
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
    if ((tool === 'wall' || tool === 'window') && drawStart.current) {
      const pt = canvasCoords(e);
      const dx = pt.x - drawStart.current.x;
      const dy = pt.y - drawStart.current.y;
      if (Math.hypot(dx, dy) < 10) { drawStart.current = null; return; }
      const seg = {
        x1: Math.round(drawStart.current.x),
        y1: Math.round(drawStart.current.y),
        x2: Math.round(pt.x),
        y2: Math.round(pt.y),
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
    const HIT = 18;
    // Try AP first
    const aps = plan.ap_placements || [];
    const apIdx = aps.findIndex(ap => Math.hypot(ap.x - pt.x, ap.y - pt.y) < HIT);
    if (apIdx >= 0) {
      const newAps = aps.filter((_, i) => i !== apIdx);
      persist({ ap_placements: newAps });
      return;
    }
    // Then door
    const doors = features.doors || [];
    const doorIdx = doors.findIndex(d => Math.hypot(d.cx - pt.x, d.cy - pt.y) < d.radius + 6);
    if (doorIdx >= 0) {
      const newFeatures = { ...features, doors: doors.filter((_, i) => i !== doorIdx) };
      persist({ features: newFeatures });
      return;
    }
    // Walls / windows by distance to segment
    for (const key of ['walls', 'windows']) {
      const segs = features[key] || [];
      const segIdx = segs.findIndex(s => distToSegment(pt, s) < HIT);
      if (segIdx >= 0) {
        const newFeatures = { ...features, [key]: segs.filter((_, i) => i !== segIdx) };
        persist({ features: newFeatures });
        return;
      }
    }
  };

  const clearDetected = async () => {
    if (!confirm('Clear all detected walls, doors, and windows?')) return;
    persist({ features: { walls: [], doors: [], windows: [] } });
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
              {['select', 'scale', 'wall', 'door', 'window', 'ap', 'erase'].map(t => (
                <button key={t}
                        className={tool === t ? 'tool-btn active' : 'tool-btn'}
                        onClick={() => { cancelScale(); selectedRef.current = null; dragRef.current = null; liveOverrideRef.current = null; setTool(t); }}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

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
                  → {(( scaleUnit === 'ft' ? parseFloat(scaleLengthInput) * 0.3048 : parseFloat(scaleLengthInput)) / scaleLineRef.current.pxLen).toFixed(5)} m/px
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
              {tool === 'door' && ' · click to drop a door'}
              {tool === 'window' && ' · click and drag to mark a window'}
              {tool === 'ap' && ' · click to place an AP'}
              {tool === 'erase' && ' · click any feature to remove it'}
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
                    style={{ width: '100%', pointerEvents: scaleMode === 'dialog' ? 'none' : 'auto' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Distance from a point to a line segment
function distToSegment(p, seg) {
  const { x1, y1, x2, y2 } = seg;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - x1, p.y - y1);
  const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
}

// Map RSSI (dBm) to a colour for the heatmap
function rssiToColor(rssi) {
  // Clamp to typical indoor range
  if (rssi > -50) return 'rgb(20, 220, 90)';     // excellent — green
  if (rssi > -60) return 'rgb(120, 220, 60)';    // good
  if (rssi > -70) return 'rgb(220, 220, 40)';    // fair — yellow
  if (rssi > -80) return 'rgb(240, 140, 40)';    // weak — orange
  if (rssi > -90) return 'rgb(220, 70, 70)';     // poor — red
  return 'rgba(80, 30, 40, 0.4)';                // dead zone
}
