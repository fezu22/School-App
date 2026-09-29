import React from 'react';
import { RefreshControl } from 'react-native';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Muted, ErrorText, Empty, Busy } from '../../../components/UI';

export default function StudentAttendanceScreen() {
  const { items, loading, error, load } = useList('/student/attendance');
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Attendance</Title>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty text="No attendance recorded yet." /> : items.map(r => (
        <Card key={r._id}>
          <Title>{r.studentId?.name}</Title>
          <Muted>{r.date} · {r.status}</Muted>
        </Card>
      ))}
    </Page>
  );
}
