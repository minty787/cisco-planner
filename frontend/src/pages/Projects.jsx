import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [showNew, setShowNew] = useState(false);

  const reload = () => api.listProjects().then(setProjects);
  useEffect(() => { reload(); }, []);

  const del = async (id) => {
    if (!confirm('Delete project and all associated floor plans and racks?')) return;
    await api.deleteProject(id);
    reload();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="crumb">/ workspace / projects</div>
          <h1>Projects</h1>
        </div>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Project</button>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <h3>No projects yet</h3>
          <p>Create a project to start planning a Cisco or Meraki deployment.</p>
          <button className="primary" onClick={() => setShowNew(true)}>+ New Project</button>
        </div>
      ) : (
        <div className="grid g-3">
          {projects.map(p => (
            <div className="card" key={p.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <Link to={`/projects/${p.id}`} style={{ color: 'var(--text)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  Project #{String(p.id).padStart(4, '0')}
                </div>
                <h3 style={{ margin: '0.4rem 0 0.3rem', letterSpacing: '-0.02em' }}>{p.name}</h3>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{p.customer || 'No customer set'}</div>
              </Link>
              <div style={{ flex: 1 }} />
              <div className="flex between" style={{ marginTop: '1rem', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                  {new Date(p.updated_at).toISOString().slice(0, 10)}
                </div>
                <div className="flex gap-1">
                  <Link to={`/projects/${p.id}`}><button className="ghost">Open</button></Link>
                  <button className="danger" onClick={() => del(p.id)}>×</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onSaved={reload} />}
    </div>
  );
}

function NewProjectModal({ onClose, onSaved }) {
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [notes, setNotes] = useState('');

  const submit = async () => {
    if (!name) { alert('Name is required'); return; }
    await api.createProject({ name, customer, notes });
    onSaved();
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>New Project</h2>
        <div><label>Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="HQ Network Refresh" /></div>
        <div style={{ marginTop: '1rem' }}><label>Customer</label><input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Acme Corp" /></div>
        <div style={{ marginTop: '1rem' }}><label>Notes</label><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <div className="flex gap-1" style={{ marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit}>Create</button>
        </div>
      </div>
    </div>
  );
}
