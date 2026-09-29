import React from 'react';
import { RefreshControl } from 'react-native';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, ErrorText, Empty, Busy } from '../../../components/UI';

export default function AuditScreen() {
  const { items, loading, error, load } = useList('/staff/admin/audit');
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Audit trail</Title>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty /> : items.map(a => (
        <Card key={a._id}>
          <Label>{a.action}</Label>
          <Muted>
            {a.actor?.name || 'User'} · {a.entity}
            {'\n'}{new Date(a.createdAt).toLocaleString()}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
