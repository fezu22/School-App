import React from 'react';
import { RefreshControl } from 'react-native';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Muted, ErrorText, Empty, Busy } from '../../../components/UI';

export default function ParentAssignmentsScreen({ navigation }) {
  const { items, loading, error, load } = useList('/parent/assignments');
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Assignments</Title>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty text="No assignments available yet." /> : items.map(a => (
        <Card key={a._id} onPress={() => navigation.navigate('AssignmentDetail', { assignment: a })}>
          <Title>{a.title}</Title>
          <Muted>{a.subject} · {a.classId?.name} {a.classId?.section}{'\n'}Due {a.dueDate}</Muted>
        </Card>
      ))}
    </Page>
  );
}
