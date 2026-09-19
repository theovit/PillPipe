import { useEffect, useState } from 'react';
import { api, onUnauthorized } from '../utils/api';
import { applyPrefs, loadPrefs } from '../utils/prefs';
import Login from './Login';

// Renders children only with a valid session. Any 401 from the API (expired or revoked session)
// drops back to the login screen; a network/server error shows Retry instead of a misleading login.
export default function AuthGate({ children }) {
  const [status, setStatus] = useState('loading'); // loading | unauthenticated | authenticated | error
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    applyPrefs(loadPrefs()); // theme for the login screen; Dashboard re-applies server prefs later
    let cancelled = false;
    api.me()
      .then(r => { if (!cancelled) setStatus(r.authenticated ? 'authenticated' : 'unauthenticated'); })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => onUnauthorized(() => setStatus(s => (s === 'authenticated' ? 'unauthenticated' : s))), []);

  if (status === 'authenticated') return children;
  if (status === 'unauthenticated') return <Login onSuccess={() => setStatus('authenticated')} />;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {status === 'loading'
        ? <p className="text-sm text-gray-500">Loading…</p>
        : (
          <div className="text-center space-y-3">
            <p className="text-sm text-gray-400">Can&apos;t reach the server.</p>
            <button onClick={() => { setStatus('loading'); setAttempt(a => a + 1); }}
              className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium border border-gray-700 transition-colors">
              Retry
            </button>
          </div>
        )}
    </div>
  );
}
