import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Devices from './pages/Devices.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import FloorPlanEditor from './pages/FloorPlanEditor.jsx';
import RackEditor from './pages/RackEditor.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="dot" />Mesh</div>
        <div className="tagline">Cisco / Meraki Planner</div>

        <div className="nav-section">Workspace</div>
        <nav className="nav">
          <NavLink to="/" end>● Overview</NavLink>
          <NavLink to="/projects">⟐ Projects</NavLink>
        </nav>

        <div className="nav-section">Catalog</div>
        <nav className="nav">
          <NavLink to="/devices">⚏ Device Library</NavLink>
        </nav>

        <div className="nav-section" style={{ marginTop: '3rem' }}>System</div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
          color: 'var(--text-faint)', padding: '0 0.5rem'
        }}>
          v1.0.0<br />
          <span style={{ color: 'var(--ok)' }}>● online</span>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/projects/:id/floorplan/:planId" element={<FloorPlanEditor />} />
          <Route path="/projects/:id/rack/:rackId" element={<RackEditor />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
