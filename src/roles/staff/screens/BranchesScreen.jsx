import React, { useState } from 'react';
import { RefreshControl } from 'react-native';
import { api } from '../../../api/client';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, Field, Button, ErrorText, Empty, Busy } from '../../../components/UI';

export default function BranchesScreen() {
  const { items, loading, error, setError, load } = useList('/staff/admin/branches');
  const [adding, setAdding] = useState(false),
    [form, setForm] = useState({}),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/staff/admin/branches', 'POST', form);
      setAdding(false);
      setForm({});
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Branches</Title>
      <ErrorText message={error} />
      <Button title={adding ? 'Cancel' : 'Add branch'} onPress={() => setAdding(!adding)} />
      {adding && (
        <Card>
          {[['name', 'Branch name'], ['address', 'Address'], ['phone', 'Phone']].map(([k, label]) => (
            <Field key={k} label={label} value={form[k] || ''} onChangeText={v => setForm(f => ({ ...f, [k]: v }))} />
          ))}
          <Button title="Save record" onPress={save} busy={busy} />
        </Card>
      )}
      {loading ? <Busy /> : !items.length ? <Empty /> : items.map(b => (
        <Card key={b._id}>
          <Label>{b.name}</Label>
          <Muted>{b.address}{'\n'}{b.phone}</Muted>
        </Card>
      ))}
    </Page>
  );
}
