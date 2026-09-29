import React from 'react';
import { RefreshControl } from 'react-native';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, ErrorText, Empty, Busy } from '../../../components/UI';

export default function ParentTimetableScreen() {
  const { items, loading, error, load } = useList('/parent/timetable');
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Timetable</Title>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty text="No timetable published yet." /> : items.map(t => (
        <Card key={t._id}>
          <Label>{t.subject}</Label>
          <Muted>
            {t.day} · {t.start}–{t.end}
            {'\n'}{t.classId?.name} {t.classId?.section} · {t.room}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
