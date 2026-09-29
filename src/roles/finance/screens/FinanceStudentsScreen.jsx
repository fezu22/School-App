import React from 'react';
import { RefreshControl } from 'react-native';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, ErrorText, Empty, Busy } from '../../../components/UI';

export default function FinanceStudentsScreen() {
  const { items, loading, error, load } = useList('/finance/students');
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Students</Title>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty text="No students in your branch." /> : items.map(s => (
        <Card key={s._id}>
          <Label>{s.name}</Label>
          <Muted>
            {s.admissionNumber} · {s.classId?.name} {s.classId?.section}
            {'\n'}Guardian: {s.guardianName}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
