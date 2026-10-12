import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Logo } from '../components/Layout';

export function LoginPage() {
  const { user, loading, demo, signIn, signUp, signInDemo } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function enterDemo() {
    setError(null);
    setBusy(true);
    try {
      await signInDemo();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await (mode === 'signin' ? signIn(email, password) : signUp(email, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  if (demo) {
    return (
      <div className="auth">
        <div className="card stack auth-card">
          <Logo />
          <h1>Live demo</h1>
          <p className="muted">
            Explore a read-only Heartbeat account: five monitors, live checks against built-in test targets, incidents and a
            public status page. Sign-ups and changes are turned off here.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" onClick={() => void enterDemo()} disabled={busy}>
            {busy ? 'Opening demo…' : 'Try the live demo'}
          </button>
          <a className="btn link center" href="/status/demo">
            Or view the public status page
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <form className="card stack auth-card" onSubmit={submit}>
        <Logo />
        <h1>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
        <p className="muted">Know when your sites go down, before your users tell you.</p>

        <label>
          Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === 'signup' ? 10 : undefined}
            required
          />
          {mode === 'signup' && <span className="hint">At least 10 characters.</span>}
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button
          type="button"
          className="btn link"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
