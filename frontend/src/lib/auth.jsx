// Who is signed in (3.5.1): password, then a one-time code; first sign-in sets up the authenticator app.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, whenSessionEnds } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [notice, setNotice] = useState('');

  const signOut = useCallback((message = '') => {
    setToken(null);
    setUser(null);
    setNotice(message);
  }, []);

  useEffect(() => {
    whenSessionEnds(() => signOut('Your session has ended. Please sign in again.'));
    if (!getToken()) return;
    api('/auth/me').then(setUser).catch(() => signOut()).finally(() => setLoading(false));
  }, [signOut]);

  /** Finishes the second step: stores the session and loads the user. */
  const complete = useCallback(({ token, user: u }) => {
    setToken(token);
    setUser(u);
    setNotice('');
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, notice, setNotice, complete, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
