import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  /** True when the server is the read-only public demo. */
  demo: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInDemo: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    // The demo flag only changes how the UI looks; if it can't be fetched, behave as a normal deployment.
    const config = api.config().then((c) => setDemo(c.demoMode), () => undefined);
    const session = api
      .me()
      .then(setUser)
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      });
    void Promise.all([config, session]).finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => setUser(await api.login(email, password)), []);
  const signUp = useCallback(async (email: string, password: string) => setUser(await api.register(email, password)), []);
  const signInDemo = useCallback(async () => setUser(await api.demoLogin()), []);
  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, demo, signIn, signUp, signInDemo, signOut }),
    [user, loading, demo, signIn, signUp, signInDemo, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
