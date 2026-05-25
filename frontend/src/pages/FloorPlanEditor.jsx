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

  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const drawStart = useRef(null);

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
  }, [plan, heatmap, showHeatmap, showFeatures, imgLoaded]);

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
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(0,212,255,0.6)';
      ctx.shadowBlur = 4;
      for (const w of features.walls || []) {
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Doors (arcs)
      ctx.strokeStyle = '#ffb020';
      ctx.lineWidth = 2.5;
      for (const d of features.doors || []) {
        ctx.beginPath();
        ctx.arc(d.cx, d.cy, d.radius, 0, Math.PI / 2);
        ctx.stroke();
      }

      // Windows (dashed)
      ctx.strokeStyle = '#3ddc97';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      for (const w of features.windows || []) {
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // APs
    for (const ap of plan.ap_placements || []) {
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

  const onMouseDown = (e) => {
    const pt = canvasCoords(e);
    if (tool === 'wall' || tool === 'window') {
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
              {['select', 'wall', 'door', 'window', 'ap', 'erase'].map(t => (
                <button key={t}
                        className={tool === t ? 'tool-btn active' : 'tool-btn'}
                        onClick={() => setTool(t)}>
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
          <div className="fp-toolbar">
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', flex: 1 }}>
              Active: <span style={{ color: 'var(--accent)' }}>{tool.toUpperCase()}</span>
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
                    style={{ width: '100%' }} />
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
