import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Keychain from 'react-native-keychain';
import { api, setAccessToken } from '../api/client';

const Context = createContext(null);
const service = 'school-platform-session';

// Role previews are for UI navigation only and cannot access protected APIs.
const DEV_USERS = {
  STUDENT: { id: 'dev-student', name: 'Ava Student', role: 'STUDENT', mustChangePassword: false },
  PARENT: { id: 'dev-parent', name: 'Sam Lee', role: 'PARENT', mustChangePassword: false },
  TEACHER: { id: 'dev-teacher', name: 'Jordan Teacher', role: 'TEACHER', mustChangePassword: false },
  PRINCIPAL: { id: 'dev-principal', name: 'Casey Principal', role: 'PRINCIPAL', mustChangePassword: false },
  SUPER_ADMIN: { id: 'dev-superadmin', name: 'Admin Super', role: 'SUPER_ADMIN', mustChangePassword: false },
  ACCOUNTANT: { id: 'dev-accountant', name: 'Riley Finance', role: 'ACCOUNTANT', mustChangePassword: false },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [schoolName, setSchoolName] = useState('School Platform');
  const [isDevMode, setIsDevMode] = useState(false);

  async function refreshBrand() {
    try {
      const data = await api('/branding');
      setSchoolName(data.schoolName);
    } catch {}
  }

  useEffect(() => {
    (async () => {
      await refreshBrand();
      // Skip restoring real session for now (login system removed temporarily)
      setLoading(false);
    })();
  }, []);

  async function signIn(email, password) {
    const data = await api('/auth/login', 'POST', { email, password });
    await Keychain.setGenericPassword('session', data.token, { service });
    setAccessToken(data.token);
    setUser(data.user);
    setIsDevMode(false);
  }

  // Quick dev login by role — no password / no API
  function devSignIn(role) {
    const mock = DEV_USERS[role];
    if (!mock) return;
    setAccessToken(''); // no real token
    setUser({ ...mock });
    setIsDevMode(true);
  }

  async function signOut() {
    if (!isDevMode) {
      try {
        await api('/auth/logout', 'POST');
      } catch {}
      try {
        await Keychain.resetGenericPassword({ service });
      } catch {}
    }
    setAccessToken('');
    setUser(null);
    setIsDevMode(false);
  }

  return (
    <Context.Provider
      value={{
        user,
        loading,
        schoolName,
        refreshBrand,
        signIn,
        devSignIn,
        signOut,
        isDevMode,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export const useAuth = () => useContext(Context);
