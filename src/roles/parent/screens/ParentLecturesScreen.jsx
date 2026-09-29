import React from 'react';
import { RefreshControl } from 'react-native';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Muted, ErrorText, Empty, Busy } from '../../../components/UI';

export default function ParentLecturesScreen({ navigation }) {
  const { items, loading, error, load } = useList('/parent/lectures');
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>AI learning</Title>
      <Muted>Published summaries, homework and quizzes.</Muted>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty text="No lecture content yet." /> : items.map(l => (
        <Card key={l._id} onPress={() => navigation.navigate('LectureDetail', { lectureId: l._id })}>
          <Title>{l.title}</Title>
          <Muted>{l.subject}</Muted>
        </Card>
      ))}
    </Page>
  );
}
