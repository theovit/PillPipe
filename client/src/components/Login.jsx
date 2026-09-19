import { useState } from 'react';
import { api } from '../utils/api';

const inputCls = 'w-full rounded bg-gray-800 border border-gray-700 px-3 py-2.5 text-base text-gray-200 focus:outline-none focus:border-violet-500';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      setPassword('');
      onSuccess();
    } catch (err) {
      if (err.status === 429) setError('Too many attempts. Wait a few minutes and try again.');
      else if (err.status === 401) setError('Incorrect password.');
      else setError('Could not sign in. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-gray-900 border border-gray-800 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-violet-500 shrink-0">
            <svg viewBox="0 0 12 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 h-8">
              <rect x="1" y="1" width="10" height="22" rx="5" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="1.75" y1="12" x2="10.25" y2="12" stroke="currentColor" strokeWidth="1.5"/>
              <rect x="1" y="1" width="10" height="11" rx="5" fill="currentColor" fillOpacity="0.35"/>
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">PillPipe</h1>
            <p className="text-xs text-gray-500 mt-1">Sign in to continue</p>
          </div>
        </div>
        {/* Hidden username lets password managers save and fill the single-user password. */}
        <input type="text" name="username" autoComplete="username" defaultValue="pillpipe"
          className="sr-only" tabIndex={-1} aria-hidden="true" readOnly />
        <div>
          <label htmlFor="password" className="block text-xs text-gray-500 mb-1">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password"
            autoFocus required value={password} onChange={e => setPassword(e.target.value)}
            className={inputCls} />
        </div>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <button type="submit" disabled={busy || !password}
          className="w-full px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
