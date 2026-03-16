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
  patchSupplement: (id, body) => request(`/supplements/${id}`, { method: 'PATCH', body }),
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

  // Version
  getVersion: () => request('/version'),

  // Backup / Restore / Clear
  getBackup: () => request('/backup'),
  restore: (body) => request('/restore', { method: 'POST', body }),
  clearData: () => request('/data', { method: 'DELETE' }),

  // Push Notifications
  getVapidKey: () => request('/push/vapid-key'),
  pushSubscribe: (subscription) => request('/push/subscribe', { method: 'POST', body: subscription }),
  pushUnsubscribe: (endpoint) => request('/push/subscribe', { method: 'DELETE', body: { endpoint } }),
  pushTest: () => request('/push/test', { method: 'POST' }),
  pushLowStockCheck: () => request('/push/low-stock-check', { method: 'POST' }),

  // Reminder time
  setReminderTime: (regimenId, reminder_time) => request(`/regimens/${regimenId}/reminder`, { method: 'PATCH', body: { reminder_time } }),

  // Dose log
  logDose: (body) => request('/dose-log', { method: 'POST', body }),
  getDoseLog: (params = {}) => request(`/dose-log?${new URLSearchParams(params)}`),

  // Templates
  getTemplates: () => request('/templates'),
  saveAsTemplate: (sessionId, body) => request(`/sessions/${sessionId}/save-as-template`, { method: 'POST', body }),
  deleteTemplate: (id) => request(`/templates/${id}`, { method: 'DELETE' }),

  // User Settings (prefs)
  getPrefs: () => request('/settings/prefs'),
  savePrefs: (prefs) => request('/settings/prefs', { method: 'PUT', body: prefs }),

  // Google Drive Backup
  getDriveStatus: () => request('/drive/status'),
  setDriveFrequency: (frequency) => request('/drive/settings', { method: 'PATCH', body: { frequency } }),
  driveBackupNow: () => request('/drive/backup', { method: 'POST' }),
  getDriveBackups: () => request('/drive/backups'),
  restoreFromDrive: (fileId) => request(`/drive/restore/${fileId}`, { method: 'POST' }),
  disconnectGoogle: () => request('/auth/google', { method: 'DELETE' }),
};
