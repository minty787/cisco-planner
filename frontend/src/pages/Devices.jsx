import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const FAMILIES = ['', 'switch', 'access_point', 'firewall', 'router', 'camera', 'sensor'];
const VENDORS = ['', 'Cisco', 'Meraki'];

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [family, setFamily] = useState('');
  const [vendor, setVendor] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showIngest, setShowIngest] = useState(false);

  const reload = () => api.listDevices({
    ...(family && { family }),
    ...(vendor && { vendor }),
  }).then(setDevices).catch(() => {});

  useEffect(() => { reload(); }, [family, vendor]);

  const del = async (id) => {
    if (!confirm('Delete this device from the catalog?')) return;
    await api.deleteDevice(id);
    reload();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumb">/ catalog / device library</div>
          <h1>Device Library</h1>
        </div>
        <div className="flex gap-1">
          <button className="ghost" onClick={() => setShowIngest(true)}>↑ Ingest PDF Datasheet</button>
          <button className="primary" onClick={() => setShowAdd(true)}>+ Add Device</button>
        </div>
      </div>

      <div className="flex gap-2 center" style={{ marginBottom: '1.5rem' }}>
        <div style={{ width: 200 }}>
          <label>Vendor</label>
          <select value={vendor} onChange={e => setVendor(e.target.value)}>
            {VENDORS.map(v => <option key={v} value={v}>{v || 'All vendors'}</option>)}
          </select>
        </div>
        <div style={{ width: 200 }}>
          <label>Family</label>
          <select value={family} onChange={e => setFamily(e.target.value)}>
            {FAMILIES.map(f => <option key={f} value={f}>{f ? f.replace('_', ' ') : 'All families'}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, textAlign: 'right', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
          {devices.length} devices
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data">
          <thead>
            <tr>
              <th>SKU</th><th>Vendor</th><th>Family</th><th>Model</th>
              <th className="num">RU</th>
              <th className="num">Power</th>
              <th>Ports</th>
              <th>Wireless</th>
              <th className="num">List $</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {devices.map(d => (
              <tr key={d.id}>
                <td className="mono">{d.sku}</td>
                <td><span className={`tag ${d.vendor.toLowerCase()}`}>{d.vendor}</span></td>
                <td style={{ color: 'var(--text-dim)' }}>{d.family.replace('_', ' ')}</td>
                <td>{d.model_name}</td>
                <td className="num">{d.rack_units || '—'}</td>
                <td className="num">{d.power_watts ? `${d.power_watts}W` : '—'}</td>
                <td className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  {[
                    d.ports_1g && `${d.ports_1g}×1G`,
                    d.ports_2_5g && `${d.ports_2_5g}×2.5G`,
                    d.ports_10g && `${d.ports_10g}×10G`,
                    d.ports_25g && `${d.ports_25g}×25G`,
                    d.ports_40g && `${d.ports_40g}×40G`,
                    d.ports_100g && `${d.ports_100g}×100G`,
                  ].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  {d.wifi_standard || '—'}
                </td>
                <td className="num">{d.list_price_usd ? `$${d.list_price_usd.toLocaleString()}` : '—'}</td>
                <td><button className="danger" onClick={() => del(d.id)}>delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <AddDeviceModal onClose={() => setShowAdd(false)} onSaved={reload} />}
      {showIngest && <IngestPdfModal onClose={() => setShowIngest(false)} onSaved={reload} />}
    </div>
  );
}

function AddDeviceModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    sku: '', vendor: 'Cisco', family: 'switch', model_name: '',
    description: '', rack_units: 1, power_watts: 0,
    ports_1g: 0, ports_10g: 0, ports_25g: 0, poe_watts: 0,
    wifi_standard: '', radios: 0, coverage_radius_m: 0, list_price_usd: 0,
  });
  const update = (k, v) => setForm({ ...form, [k]: v });
  const submit = async () => {
    if (!form.sku || !form.model_name) { alert('SKU and Model Name are required'); return; }
    await api.createDevice(form);
    onSaved();
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Device</h2>
        <div className="grid g-2">
          <div><label>SKU</label><input value={form.sku} onChange={e => update('sku', e.target.value)} className="mono" /></div>
          <div><label>Model Name</label><input value={form.model_name} onChange={e => update('model_name', e.target.value)} /></div>
          <div><label>Vendor</label>
            <select value={form.vendor} onChange={e => update('vendor', e.target.value)}>
              <option>Cisco</option><option>Meraki</option>
            </select>
          </div>
          <div><label>Family</label>
            <select value={form.family} onChange={e => update('family', e.target.value)}>
              <option value="switch">switch</option>
              <option value="access_point">access_point</option>
              <option value="firewall">firewall</option>
              <option value="router">router</option>
              <option value="camera">camera</option>
              <option value="sensor">sensor</option>
            </select>
          </div>
          <div><label>Rack Units</label><input type="number" step="0.5" value={form.rack_units} onChange={e => update('rack_units', parseFloat(e.target.value))} /></div>
          <div><label>Power (W)</label><input type="number" value={form.power_watts} onChange={e => update('power_watts', parseFloat(e.target.value))} /></div>
          <div><label>1G Ports</label><input type="number" value={form.ports_1g} onChange={e => update('ports_1g', parseInt(e.target.value) || 0)} /></div>
          <div><label>10G Ports</label><input type="number" value={form.ports_10g} onChange={e => update('ports_10g', parseInt(e.target.value) || 0)} /></div>
          <div><label>PoE Budget (W)</label><input type="number" value={form.poe_watts} onChange={e => update('poe_watts', parseFloat(e.target.value))} /></div>
          <div><label>WiFi Standard</label>
            <select value={form.wifi_standard} onChange={e => update('wifi_standard', e.target.value)}>
              <option value="">none</option>
              <option value="wifi5">Wi-Fi 5</option>
              <option value="wifi6">Wi-Fi 6</option>
              <option value="wifi6e">Wi-Fi 6E</option>
              <option value="wifi7">Wi-Fi 7</option>
            </select>
          </div>
          <div><label>Coverage Radius (m)</label><input type="number" value={form.coverage_radius_m} onChange={e => update('coverage_radius_m', parseFloat(e.target.value))} /></div>
          <div><label>List Price (USD)</label><input type="number" value={form.list_price_usd} onChange={e => update('list_price_usd', parseFloat(e.target.value))} /></div>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <label>Description</label>
          <textarea rows={2} value={form.description} onChange={e => update('description', e.target.value)} />
        </div>
        <div className="flex gap-1" style={{ marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit}>Save Device</button>
        </div>
      </div>
    </div>
  );
}

function IngestPdfModal({ onClose, onSaved }) {
  const fileRef = useRef();
  const [preferAi, setPreferAi] = useState(true);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const upload = async (save) => {
    const f = fileRef.current?.files?.[0];
    if (!f) { setErr('Please choose a PDF file'); return; }
    setBusy(true); setErr('');
    try {
      const result = await api.ingestPdf(f, preferAi, save);
      setParsed(result);
      if (save) onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Ingest Datasheet PDF</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginTop: 0 }}>
          Upload a Cisco or Meraki datasheet. Mesh will parse the specs — set
          <span className="mono"> ANTHROPIC_API_KEY</span> on the backend for AI-grade extraction.
        </p>
        <div><label>PDF File</label><input ref={fileRef} type="file" accept="application/pdf" /></div>
        <div style={{ marginTop: '1rem' }}>
          <label>
            <input type="checkbox" style={{ width: 'auto', marginRight: 8 }}
                   checked={preferAi} onChange={e => setPreferAi(e.target.checked)} />
            Use Anthropic API if available
          </label>
        </div>
        {err && <div style={{ color: 'var(--danger)', marginTop: '0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{err}</div>}
        {parsed && (
          <pre style={{
            background: 'var(--bg-elev)', padding: '1rem', borderRadius: 4,
            border: '1px solid var(--border)', maxHeight: 240, overflow: 'auto',
            fontSize: '0.75rem', marginTop: '1rem',
          }}>
            {JSON.stringify(parsed, null, 2)}
          </pre>
        )}
        <div className="flex gap-1" style={{ marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="ghost" onClick={() => upload(false)} disabled={busy}>{busy ? 'Parsing…' : 'Preview Only'}</button>
          <button className="primary" onClick={() => upload(true)} disabled={busy}>Parse + Save</button>
        </div>
      </div>
    </div>
  );
}
