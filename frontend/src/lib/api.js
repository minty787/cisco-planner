const BASE = '/api';

async function http(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: opts.body && !(opts.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {},
    ...opts,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  // Devices
  listDevices: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return http(`/devices${q ? `?${q}` : ''}`);
  },
  getDevice: (id) => http(`/devices/${id}`),
  createDevice: (data) => http(`/devices`, { method: 'POST', body: JSON.stringify(data) }),
  deleteDevice: (id) => http(`/devices/${id}`, { method: 'DELETE' }),
  ingestPdf: (file, preferAi, save) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('prefer_ai', preferAi);
    fd.append('save', save);
    return http(`/devices/ingest-pdf`, { method: 'POST', body: fd });
  },

  // Projects
  listProjects: () => http(`/projects`),
  getProject: (id) => http(`/projects/${id}`),
  createProject: (data) => http(`/projects`, { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, patch) => http(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteProject: (id) => http(`/projects/${id}`, { method: 'DELETE' }),

  // Floor plans
  listFloorplans: (pid) => http(`/projects/${pid}/floorplans`),
  uploadFloorplan: (pid, name, file, autoDetect = true) => {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('file', file);
    fd.append('auto_detect', autoDetect);
    return http(`/projects/${pid}/floorplans`, { method: 'POST', body: fd });
  },
  getFloorplan: (id) => http(`/floorplans/${id}`),
  updateFloorplan: (id, patch) => http(`/floorplans/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteFloorplan: (id) => http(`/floorplans/${id}`, { method: 'DELETE' }),
  floorplanImageUrl: (id) => `${BASE}/floorplans/${id}/image`,
  computeHeatmap: (id) => http(`/floorplans/${id}/heatmap`, { method: 'POST' }),

  // Racks
  listRacks: (pid) => http(`/projects/${pid}/racks`),
  createRack: (pid, data) => http(`/projects/${pid}/racks`, { method: 'POST', body: JSON.stringify(data) }),
  updateRack: (id, patch) => http(`/racks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteRack: (id) => http(`/racks/${id}`, { method: 'DELETE' }),

  // BOM
  getBom: (pid) => http(`/projects/${pid}/bom`),
};
