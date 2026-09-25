import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Keychain from 'react-native-keychain';
import { api, setAccessToken } from '../api/client';
const Context = createContext(null);
const service = 'school-platform-session';
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [schoolName, setSchoolName] = useState('School Platform');
  async function refreshBrand() {
    try {
      const data = await api('/branding');
      setSchoolName(data.schoolName);
    } catch {}
  }
  useEffect(() => {
    (async () => {
      await refreshBrand();
      try {
        const stored = await Keychain.getGenericPassword({ service });
        if (stored) {
          setAccessToken(stored.password);
          const data = await api('/auth/me');
          setUser(data.user);
        }
      } catch {
        setAccessToken('');
        await Keychain.resetGenericPassword({ service });
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  async function signIn(email, password) {
    const data = await api('/auth/login', 'POST', { email, password });
    await Keychain.setGenericPassword('session', data.token, { service });
    setAccessToken(data.token);
    setUser(data.user);
  }
  async function signOut() {
    try {
      await api('/auth/logout', 'POST');
    } catch {
    } finally {
      setAccessToken('');
      await Keychain.resetGenericPassword({ service });
      setUser(null);
    }
  }
  return (
    <Context.Provider
      value={{ user, loading, schoolName, refreshBrand, signIn, signOut }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
