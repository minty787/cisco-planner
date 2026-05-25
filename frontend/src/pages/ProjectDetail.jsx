import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState('floorplans');
  const [floorplans, setFloorplans] = useState([]);
  const [racks, setRacks] = useState([]);
  const [bom, setBom] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showNewRack, setShowNewRack] = useState(false);

  const reload = async () => {
    const [p, fps, rs, b] = await Promise.all([
      api.getProject(id),
      api.listFloorplans(id),
      api.listRacks(id),
      api.getBom(id),
    ]);
    setProject(p); setFloorplans(fps); setRacks(rs); setBom(b);
  };
  useEffect(() => { reload(); }, [id]);

  if (!project) return <div style={{ color: 'var(--text-dim)' }}>Loading…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumb">/ projects / {project.name.toLowerCase().replace(/\s/g, '-')}</div>
          <h1>{project.name}</h1>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.95rem', marginTop: '0.3rem' }}>
            {project.customer || 'No customer'}
            {project.notes && ` · ${project.notes}`}
          </div>
        </div>
        <Link to="/projects"><button className="ghost">← All Projects</button></Link>
      </div>

      {bom && (
        <div className="grid g-4" style={{ marginBottom: '2rem' }}>
          <div className="stat">
            <div className="k">Total Devices</div>
            <div className="v">{bom.device_count}</div>
            <div className="sub">across all racks and floors</div>
          </div>
          <div className="stat">
            <div className="k">Total List Price</div>
            <div className="v">${bom.total_usd.toLocaleString()}</div>
            <div className="sub">USD, list pricing</div>
          </div>
          <div className="stat">
            <div className="k">Rack Units</div>
            <div className="v">{bom.total_rack_units}</div>
            <div className="sub">consumed</div>
          </div>
          <div className="stat">
            <div className="k">Power Draw</div>
            <div className="v">{bom.total_power_watts}<span style={{ fontSize: '1rem', color: 'var(--text-dim)' }}>W</span></div>
            <div className="sub">peak estimated</div>
          </div>
        </div>
      )}

      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        {['floorplans', 'racks', 'bom'].map(t => (
          <button key={t}
                  onClick={() => setTab(t)}
                  className={tab === t ? 'tool-btn active' : 'tool-btn'}
                  style={{ borderRadius: 0, borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent' }}>
            {t === 'floorplans' ? 'Floor Plans & WiFi' : t === 'racks' ? 'Rack Layouts' : 'Bill of Materials'}
          </button>
        ))}
      </div>

      {tab === 'floorplans' && (
        <div>
          <div className="flex between center" style={{ marginBottom: '1rem' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              {floorplans.length} floor plan(s). Upload an image — Mesh detects walls, doors, and windows automatically.
            </div>
            <button className="primary" onClick={() => setShowUpload(true)}>+ Upload Floor Plan</button>
          </div>
          {floorplans.length === 0 ? (
            <div className="empty">
              <h3>No floor plans yet</h3>
              <p>Upload a PNG or JPG of your building plan to start placing access points.</p>
              <button className="primary" onClick={() => setShowUpload(true)}>+ Upload Floor Plan</button>
            </div>
          ) : (
            <div className="grid g-3">
              {floorplans.map(fp => (
                <FloorPlanCard key={fp.id} fp={fp} projectId={id} onReload={reload} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'racks' && (
        <div>
          <div className="flex between center" style={{ marginBottom: '1rem' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              {racks.length} rack(s). Drop switches, firewalls, and routers into U slots.
            </div>
            <button className="primary" onClick={() => setShowNewRack(true)}>+ New Rack</button>
          </div>
          {racks.length === 0 ? (
            <div className="empty">
              <h3>No racks yet</h3>
              <p>Add a rack to start laying out switches and other rack-mount equipment.</p>
              <button className="primary" onClick={() => setShowNewRack(true)}>+ New Rack</button>
            </div>
          ) : (
            <div className="grid g-3">
              {racks.map(r => (
                <RackCard key={r.id} rack={r} projectId={id} onReload={reload} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'bom' && bom && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {bom.line_items.length === 0 ? (
            <div className="empty" style={{ border: 'none' }}>
              <h3>BOM is empty</h3>
              <p>Add devices to racks or place access points on floor plans to populate the BOM.</p>
            </div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>SKU</th><th>Vendor</th><th>Family</th><th>Model</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit $</th>
                  <th className="num">Subtotal</th>
                  <th className="num">RU each</th>
                  <th className="num">W each</th>
                </tr>
              </thead>
              <tbody>
                {bom.line_items.map(item => (
                  <tr key={item.device_id}>
                    <td className="mono">{item.sku}</td>
                    <td><span className={`tag ${item.vendor.toLowerCase()}`}>{item.vendor}</span></td>
                    <td style={{ color: 'var(--text-dim)' }}>{item.family.replace('_', ' ')}</td>
                    <td>{item.model_name}</td>
                    <td className="num">{item.quantity}</td>
                    <td className="num">${item.unit_price_usd.toLocaleString()}</td>
                    <td className="num" style={{ color: 'var(--accent)' }}>${item.subtotal_usd.toLocaleString()}</td>
                    <td className="num">{item.rack_units_each}</td>
                    <td className="num">{item.power_watts_each}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--bg-elev)', fontWeight: 700 }}>
                  <td colSpan={6} style={{ textAlign: 'right' }}>TOTAL</td>
                  <td className="num" style={{ color: 'var(--accent)', fontSize: '1.05rem' }}>
                    ${bom.total_usd.toLocaleString()}
                  </td>
                  <td className="num">{bom.total_rack_units}</td>
                  <td className="num">{bom.total_power_watts}W</td>
                </tr>
              </tbody>
            </table>
          )}
          <div style={{ padding: '1rem', borderTop: '1px solid var(--border)' }}>
            <button className="ghost" onClick={() => downloadCsv(bom)}>↓ Export CSV</button>
          </div>
        </div>
      )}

      {showUpload && <UploadFloorPlanModal projectId={id} onClose={() => setShowUpload(false)} onSaved={reload} />}
      {showNewRack && <NewRackModal projectId={id} onClose={() => setShowNewRack(false)} onSaved={reload} />}
    </div>
  );
}

function FloorPlanCard({ fp, projectId, onReload }) {
  const features = fp.features || {};
  const apCount = (fp.ap_placements || []).length;
  const del = async () => {
    if (!confirm('Delete floor plan?')) return;
    await api.deleteFloorplan(fp.id); onReload();
  };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{
        height: 160,
        background: `var(--bg-elev) url(${api.floorplanImageUrl(fp.id)}) center/contain no-repeat`,
        borderRadius: 4,
        border: '1px solid var(--border)',
        marginBottom: '0.85rem',
      }} />
      <h3 style={{ margin: '0 0 0.3rem', letterSpacing: '-0.02em' }}>{fp.name}</h3>
      <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
        {fp.width_px} × {fp.height_px} px · scale {fp.scale_m_per_px}m/px
      </div>
      <div className="flex gap-2" style={{ margin: '0.75rem 0', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
        <span>⌐ {(features.walls || []).length} walls</span>
        <span>◜ {(features.doors || []).length} doors</span>
        <span>▤ {(features.windows || []).length} windows</span>
        <span style={{ color: 'var(--accent)' }}>⌬ {apCount} APs</span>
      </div>
      <div className="flex gap-1" style={{ marginTop: 'auto' }}>
        <Link to={`/projects/${projectId}/floorplan/${fp.id}`} style={{ flex: 1 }}>
          <button className="primary" style={{ width: '100%' }}>Edit Plan</button>
        </Link>
        <button className="danger" onClick={del}>×</button>
      </div>
    </div>
  );
}

function RackCard({ rack, projectId, onReload }) {
  const used = (rack.slots || []).filter(s => s.device_id).length;
  const del = async () => {
    if (!confirm('Delete rack?')) return;
    await api.deleteRack(rack.id); onReload();
  };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        Rack · {rack.height_u}U
      </div>
      <h3 style={{ margin: '0.3rem 0', letterSpacing: '-0.02em' }}>{rack.name}</h3>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{rack.location || 'no location set'}</div>
      <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.75rem' }}>
        {used} / {rack.height_u}U populated
      </div>
      <div style={{
        height: 6, background: 'var(--bg-elev)', borderRadius: 3,
        marginTop: '0.4rem', overflow: 'hidden',
      }}>
        <div style={{
          width: `${(used / rack.height_u) * 100}%`,
          height: '100%', background: 'var(--accent)',
        }} />
      </div>
      <div className="flex gap-1" style={{ marginTop: '1rem' }}>
        <Link to={`/projects/${projectId}/rack/${rack.id}`} style={{ flex: 1 }}>
          <button className="primary" style={{ width: '100%' }}>Edit Rack</button>
        </Link>
        <button className="danger" onClick={del}>×</button>
      </div>
    </div>
  );
}

function UploadFloorPlanModal({ projectId, onClose, onSaved }) {
  const fileRef = useRef();
  const [name, setName] = useState('');
  const [autoDetect, setAutoDetect] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f || !name) { alert('Name and file are required'); return; }
    setBusy(true);
    try {
      await api.uploadFloorplan(projectId, name, f, autoDetect);
      onSaved(); onClose();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Upload Floor Plan</h2>
        <div><label>Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Ground Floor" /></div>
        <div style={{ marginTop: '1rem' }}><label>Image (PNG/JPG)</label><input ref={fileRef} type="file" accept="image/*" /></div>
        <div style={{ marginTop: '1rem' }}>
          <label>
            <input type="checkbox" style={{ width: 'auto', marginRight: 8 }}
                   checked={autoDetect} onChange={e => setAutoDetect(e.target.checked)} />
            Auto-detect walls, doors, and windows
          </label>
        </div>
        <div className="flex gap-1" style={{ marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={busy}>{busy ? 'Analysing…' : 'Upload + Analyse'}</button>
        </div>
      </div>
    </div>
  );
}

function NewRackModal({ projectId, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [heightU, setHeightU] = useState(42);
  const submit = async () => {
    if (!name) { alert('Name is required'); return; }
    await api.createRack(projectId, { name, location, height_u: heightU, project_id: parseInt(projectId), slots: [] });
    onSaved(); onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>New Rack</h2>
        <div><label>Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="MDF-A" /></div>
        <div style={{ marginTop: '1rem' }}><label>Location</label><input value={location} onChange={e => setLocation(e.target.value)} placeholder="Server Room 1" /></div>
        <div style={{ marginTop: '1rem' }}><label>Height (U)</label><input type="number" value={heightU} onChange={e => setHeightU(parseInt(e.target.value) || 42)} /></div>
        <div className="flex gap-1" style={{ marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit}>Create</button>
        </div>
      </div>
    </div>
  );
}

function downloadCsv(bom) {
  const header = 'SKU,Vendor,Family,Model,Qty,UnitPrice,Subtotal,RU,Watts\n';
  const lines = bom.line_items.map(i =>
    `${i.sku},${i.vendor},${i.family},"${i.model_name}",${i.quantity},${i.unit_price_usd},${i.subtotal_usd},${i.rack_units_each},${i.power_watts_each}`
  ).join('\n');
  const blob = new Blob([header + lines], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `bom-${bom.project_id}.csv`; a.click();
  URL.revokeObjectURL(url);
}
