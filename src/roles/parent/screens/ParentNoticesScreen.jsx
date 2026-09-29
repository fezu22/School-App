import React from 'react';
import { RefreshControl } from 'react-native';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, ErrorText, Empty, Busy } from '../../../components/UI';

export default function ParentNoticesScreen() {
  const { items, loading, error, load } = useList('/parent/notices');
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Notices</Title>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty text="No notices yet." /> : items.map(n => (
        <Card key={n._id}>
          <Label>{n.title}</Label>
          <Muted>{n.body}</Muted>
        </Card>
      ))}
    </Page>
  );
}
