const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Supplements
  getSupplements: () => request('/supplements'),
  createSupplement: (body) => request('/supplements', { method: 'POST', body }),
  updateSupplement: (id, body) => request(`/supplements/${id}`, { method: 'PUT', body }),
  deleteSupplement: (id) => request(`/supplements/${id}`, { method: 'DELETE' }),

  // Sessions
  getSessions: () => request('/sessions'),
  createSession: (body) => request('/sessions', { method: 'POST', body }),
  updateSession: (id, body) => request(`/sessions/${id}`, { method: 'PUT', body }),
  deleteSession: (id) => request(`/sessions/${id}`, { method: 'DELETE' }),
  copySession: (id, body) => request(`/sessions/${id}/copy`, { method: 'POST', body }),

  // Regimens
  getRegimens: (sessionId) => request(`/sessions/${sessionId}/regimens`),
  createRegimen: (sessionId, body) => request(`/sessions/${sessionId}/regimens`, { method: 'POST', body }),
  updateRegimen: (id, body) => request(`/regimens/${id}`, { method: 'PATCH', body }),
  deleteRegimen: (id) => request(`/regimens/${id}`, { method: 'DELETE' }),

  // Phases
  getPhases: (regimenId) => request(`/regimens/${regimenId}/phases`),
  createPhase: (regimenId, body) => request(`/regimens/${regimenId}/phases`, { method: 'POST', body }),
  updatePhase: (id, body) => request(`/phases/${id}`, { method: 'PUT', body }),
  deletePhase: (id) => request(`/phases/${id}`, { method: 'DELETE' }),

  // Calculate
  calculate: (sessionId) => request(`/sessions/${sessionId}/calculate`),
};
