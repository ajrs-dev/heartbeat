import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--good)" />
        <path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Heartbeat
    </span>
  );
}

export function Layout() {
  const { user, signOut } = useAuth();
  return (
    <>
      <header className="topbar">
        <div className="container row between">
          <Link to="/" className="brand">
            <Logo />
          </Link>
          <nav className="row">
            {user && (
              <>
                <a href={`/status/${user.slug}`} className="link-muted">
                  Public status page
                </a>
                <span className="link-muted hide-small">{user.email}</span>
                <button className="btn small" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  );
}
