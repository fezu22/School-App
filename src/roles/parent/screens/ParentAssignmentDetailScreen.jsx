import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { Page, Card, Title, Muted, ErrorText, Empty } from '../../../components/UI';

export default function ParentAssignmentDetailScreen({ route }) {
  const assignment = route.params.assignment;
  const [items, setItems] = useState([]),
    [error, setError] = useState('');
  useEffect(() => {
    api(`/parent/assignments/${assignment._id}/submissions`)
      .then(d => setItems(d.items))
      .catch(e => setError(e.message));
  }, [assignment._id]);
  return (
    <Page>
      <Title>{assignment.title}</Title>
      <Muted>{assignment.subject} · Due {assignment.dueDate} · {assignment.maxMarks} marks</Muted>
      <Card><Muted>{assignment.instructions}</Muted></Card>
      <ErrorText message={error} />
      <Title>Child's submission</Title>
      {!items.length && <Empty text="No submission yet." />}
      {items.map(item => (
        <Card key={item._id}>
          <Title>{item.studentId?.name}</Title>
          <Muted>{item.answer}</Muted>
          <Muted>
            {item.marks === undefined ? 'Awaiting review' : `Marks: ${item.marks}/${assignment.maxMarks}`}
            {'\n'}{item.feedback}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
