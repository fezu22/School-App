import React, { useState } from 'react';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { Page, Title, Field, Button, ErrorText, Muted } from '../../../components/UI';
export default function SettingsScreen() {
  const { schoolName, refreshBrand } = useAuth();
  const [name, setName] = useState(schoolName),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api('/staff/admin/branding', 'PUT', { schoolName: name });
      await refreshBrand();
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Title>School identity</Title>
      <Field label="School name" value={name} onChangeText={setName} />
      <ErrorText message={error} />
      <Button title="Save school name" onPress={save} busy={busy} />
      {saved && <Muted>School name saved.</Muted>}
    </Page>
  );
}
