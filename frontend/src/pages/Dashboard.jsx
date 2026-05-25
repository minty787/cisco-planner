import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
    api.listDevices().then(setDevices).catch(() => {});
  }, []);

  const apCount = devices.filter(d => d.family === 'access_point').length;
  const switchCount = devices.filter(d => d.family === 'switch').length;
  const ciscoCount = devices.filter(d => d.vendor === 'Cisco').length;
  const merakiCount = devices.filter(d => d.vendor === 'Meraki').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumb">/ workspace / overview</div>
          <h1>Network Planning, Engineered.</h1>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem', maxWidth: 380, textAlign: 'right' }}>
          Plan rack layouts, model WiFi coverage, and generate complete BOMs
          for Cisco Catalyst and Cisco Meraki deployments.
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: '2.5rem' }}>
        <div className="stat">
          <div className="k">Active Projects</div>
          <div className="v">{projects.length}</div>
          <div className="sub">{projects.length === 0 ? 'Create your first project →' : 'across all customers'}</div>
        </div>
        <div className="stat">
          <div className="k">Device Catalog</div>
          <div className="v">{devices.length}</div>
          <div className="sub">{ciscoCount} Cisco · {merakiCount} Meraki</div>
        </div>
        <div className="stat">
          <div className="k">Access Points</div>
          <div className="v">{apCount}</div>
          <div className="sub">in library</div>
        </div>
        <div className="stat">
          <div className="k">Switches</div>
          <div className="v">{switchCount}</div>
          <div className="sub">in library</div>
        </div>
      </div>

      <div className="grid g-2">
        <div className="card">
          <h3 style={{ margin: '0 0 1rem', letterSpacing: '-0.02em' }}>Get Started</h3>
          <ol style={{ color: 'var(--text-dim)', lineHeight: 1.8, paddingLeft: '1.2rem' }}>
            <li>Create a <Link to="/projects">project</Link> for your customer.</li>
            <li>Upload a floor plan — walls and doors are detected automatically.</li>
            <li>Drop in access points and instantly visualise WiFi coverage.</li>
            <li>Lay out racks and pick devices from the catalog.</li>
            <li>Export the generated Bill of Materials.</li>
          </ol>
        </div>
        <div className="card">
          <h3 style={{ margin: '0 0 1rem', letterSpacing: '-0.02em' }}>Extend the Catalog</h3>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.7, marginTop: 0 }}>
            New Cisco/Meraki devices ship constantly. Drop a vendor datasheet PDF
            into <Link to="/devices">Device Library</Link> and Mesh will parse the specs —
            with optional Anthropic-API-powered structured extraction for noisy
            PDFs.
          </p>
          <Link to="/devices"><button className="ghost">Open Device Library →</button></Link>
        </div>
      </div>

      <div style={{ marginTop: '2.5rem' }}>
        <h3 style={{ letterSpacing: '-0.02em' }}>Recent Projects</h3>
        {projects.length === 0 ? (
          <div className="empty">
            <h3>No projects yet</h3>
            <p>Start by creating one from the Projects page.</p>
            <Link to="/projects"><button className="primary">Create Project</button></Link>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th><th>Customer</th><th>Updated</th><th></th>
              </tr>
            </thead>
            <tbody>
              {projects.slice(0, 5).map(p => (
                <tr key={p.id}>
                  <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                  <td style={{ color: 'var(--text-dim)' }}>{p.customer || '—'}</td>
                  <td className="mono" style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>
                    {new Date(p.updated_at).toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td><Link to={`/projects/${p.id}`}>open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
