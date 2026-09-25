import React, { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Page, Title, Muted, Field, Button, ErrorText } from '../components/UI';
export default function PasswordScreen() {
  const { signOut } = useAuth();
  const [old, setOld] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save() {
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await api('/auth/password', 'POST', {
        currentPassword: old,
        newPassword: password,
      });
      await signOut();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Title>Secure your account</Title>
      <Muted>
        Set your personal password (at least 12 characters). You will sign in
        again after saving.
      </Muted>
      <Field
        label="Current password"
        value={old}
        onChangeText={setOld}
        password
      />
      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        password
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        password
      />
      <ErrorText message={error} />
      <Button title="Change password" onPress={save} busy={busy} />
      <Button title="Sign out" onPress={signOut} secondary />
    </Page>
  );
}
