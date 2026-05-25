import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

/**
 * RackEditor
 *
 * Visualises a rack from top (U1) to bottom. Clicking an empty slot opens a
 * device picker (filtered to rack-mountable devices). Clicking a populated
 * slot lets you remove the device.
 */
export default function RackEditor() {
  const { id: projectId, rackId } = useParams();
  const [rack, setRack] = useState(null);
  const [devices, setDevices] = useState([]);
  const [pickerSlot, setPickerSlot] = useState(null); // U number being filled

  useEffect(() => {
    api.listRacks(projectId).then(rs => setRack(rs.find(r => r.id === parseInt(rackId))));
    api.listDevices().then(ds => setDevices(ds.filter(d => d.rack_units > 0)));
  }, [projectId, rackId]);

  if (!rack) return <div style={{ color: 'var(--text-dim)' }}>Loading…</div>;

  const slots = rack.slots || [];

  // Map U position → slot object covering that U (a device may span several U)
  const slotMap = {};
  for (const s of slots) {
    if (!s.device_id) continue;
    const device = devices.find(d => d.id === s.device_id);
    const span = device ? Math.max(1, Math.ceil(device.rack_units)) : 1;
    for (let i = 0; i < span; i++) {
      slotMap[s.u_position + i] = { ...s, span, isAnchor: i === 0, device };
    }
  }

  const placeDevice = async (uPos, deviceId) => {
    const device = devices.find(d => d.id === deviceId);
    const span = Math.max(1, Math.ceil(device.rack_units));
    // Check fit
    for (let i = 0; i < span; i++) {
      if (slotMap[uPos + i]) { alert(`U${uPos + i} is occupied`); return; }
      if (uPos + i > rack.height_u) { alert('Not enough space'); return; }
    }
    const newSlots = [...slots, { u_position: uPos, device_id: deviceId, label: device.sku }];
    const updated = await api.updateRack(rackId, { slots: newSlots });
    setRack(updated);
    setPickerSlot(null);
  };

  const removeAt = async (uPos) => {
    // Find anchor for this U
    const anchor = slots.find(s => {
      const device = devices.find(d => d.id === s.device_id);
      const span = device ? Math.max(1, Math.ceil(device.rack_units)) : 1;
      return uPos >= s.u_position && uPos < s.u_position + span;
    });
    if (!anchor) return;
    const newSlots = slots.filter(s => s !== anchor);
    const updated = await api.updateRack(rackId, { slots: newSlots });
    setRack(updated);
  };

  // Generate U rows top-down (highest U at top)
  const rows = [];
  for (let u = rack.height_u; u >= 1; u--) rows.push(u);

  const used = Object.keys(slotMap).length;
  const totalPower = slots.reduce((sum, s) => {
    const d = devices.find(x => x.id === s.device_id);
    return sum + (d?.power_watts || 0);
  }, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumb">/ projects / rack</div>
          <h1>{rack.name}</h1>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
            {rack.location || 'no location'} · {rack.height_u}U
          </div>
        </div>
        <Link to={`/projects/${projectId}`}><button className="ghost">← Back to Project</button></Link>
      </div>

      <div className="grid g-3" style={{ marginBottom: '1.5rem' }}>
        <div className="stat">
          <div className="k">Slots Used</div>
          <div className="v">{used} <span style={{ fontSize: '1rem', color: 'var(--text-dim)' }}>/ {rack.height_u}</span></div>
          <div className="sub">{Math.round((used / rack.height_u) * 100)}% capacity</div>
        </div>
        <div className="stat">
          <div className="k">Power Draw</div>
          <div className="v">{totalPower}<span style={{ fontSize: '1rem', color: 'var(--text-dim)' }}>W</span></div>
          <div className="sub">peak estimated</div>
        </div>
        <div className="stat">
          <div className="k">Devices</div>
          <div className="v">{slots.filter(s => s.device_id).length}</div>
          <div className="sub">in this rack</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 360px', gap: '1.5rem' }}>
        <div className="rack-wrap">
          <div style={{
            textAlign: 'center', fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem', color: 'var(--text-faint)',
            letterSpacing: '0.15em', textTransform: 'uppercase',
            padding: '0.4rem 0', borderBottom: '1px solid var(--border)',
          }}>
            FRONT VIEW — TOP
          </div>
          {rows.map(u => {
            const slot = slotMap[u];
            if (slot && !slot.isAnchor) return null; // device spans, drawn at anchor
            return (
              <div className="rack-row" key={u} style={{
                height: slot ? slot.span * 22 : 22,
              }}>
                <div className="u-label">U{String(u).padStart(2, '0')}</div>
                {slot ? (
                  <div className={`rack-slot-filled ${slot.device?.family || ''}`}
                       onClick={() => { if (confirm(`Remove ${slot.device?.sku}?`)) removeAt(u); }}>
                    <span style={{ flex: 1 }}>{slot.device?.vendor} · {slot.device?.sku}</span>
                    <span style={{ color: 'var(--text-dim)' }}>{slot.device?.power_watts}W</span>
                  </div>
                ) : (
                  <div className="u-slot" onClick={() => setPickerSlot(u)} />
                )}
              </div>
            );
          })}
          <div style={{
            textAlign: 'center', fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem', color: 'var(--text-faint)',
            letterSpacing: '0.15em', textTransform: 'uppercase',
            padding: '0.4rem 0', borderTop: '1px solid var(--border)',
          }}>
            BOTTOM
          </div>
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>How to use</h3>
          <ol style={{ color: 'var(--text-dim)', fontSize: '0.85rem', lineHeight: 1.7, paddingLeft: '1.2rem' }}>
            <li>Click any empty U slot to open the device picker.</li>
            <li>Choose a switch, router, firewall, or appliance.</li>
            <li>Multi-U devices automatically span adjacent slots.</li>
            <li>Click a populated slot to remove the device.</li>
          </ol>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1rem 0' }} />
          <h3 style={{ margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>Legend</h3>
          <div className="legend" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div className="pill"><div className="swatch" style={{ background: 'linear-gradient(180deg, #1c2838, #14202d)', borderColor: '#00d4ff' }} /> switch</div>
            <div className="pill"><div className="swatch" style={{ background: 'linear-gradient(180deg, #1c2838, #14202d)', borderColor: '#ff4f5e' }} /> firewall</div>
            <div className="pill"><div className="swatch" style={{ background: 'linear-gradient(180deg, #1c2838, #14202d)', borderColor: '#ffb020' }} /> router</div>
            <div className="pill"><div className="swatch" style={{ background: 'linear-gradient(180deg, #1c2838, #14202d)', borderColor: '#3ddc97' }} /> access point</div>
          </div>
        </div>
      </div>

      {pickerSlot !== null && (
        <DevicePicker u={pickerSlot}
                      devices={devices}
                      onClose={() => setPickerSlot(null)}
                      onPick={(id) => placeDevice(pickerSlot, id)} />
      )}
    </div>
  );
}

function DevicePicker({ u, devices, onClose, onPick }) {
  const [filter, setFilter] = useState('');
  const filtered = devices.filter(d =>
    !filter ||
    d.sku.toLowerCase().includes(filter.toLowerCase()) ||
    d.model_name.toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 720 }}>
        <h2>Place Device at U{u}</h2>
        <input placeholder="Filter by SKU or model…" value={filter} onChange={e => setFilter(e.target.value)} />
        <div style={{ maxHeight: '60vh', overflow: 'auto', marginTop: '1rem' }}>
          <table className="data">
            <thead>
              <tr><th>SKU</th><th>Family</th><th className="num">RU</th><th className="num">W</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id}>
                  <td className="mono">{d.sku}<div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{d.model_name}</div></td>
                  <td><span className={`tag ${d.vendor.toLowerCase()}`}>{d.family.replace('_', ' ')}</span></td>
                  <td className="num">{d.rack_units}</td>
                  <td className="num">{d.power_watts}</td>
                  <td><button className="primary" onClick={() => onPick(d.id)}>Place</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
