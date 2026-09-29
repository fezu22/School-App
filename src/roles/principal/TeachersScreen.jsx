import React from 'react';
import { RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { getPrincipalTeachers } from '../../api/principal';
import { useAuth } from '../../auth/AuthContext';
import { Busy, Button, Card, Empty, ErrorText, Label, Muted, Page, Title } from '../../components/UI';

export default function TeachersScreen() {
  const { signOut, isDevMode } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (isDevMode) {
      setItems([]);
      setError('Preview mode has no API session. Sign in with a school account to load live data.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setItems((await getPrincipalTeachers()).items || []);
    } catch (cause) {
      if (cause.status === 401) {
        setError('Your session has expired. Sign in again to continue.');
        await signOut();
      } else if (cause.status === 403) {
        setError('You do not have access to the teacher directory.');
      } else if (cause.status === 404) {
        setError('The teacher directory is not available right now.');
      } else if (cause.status >= 500) {
        setError('The directory could not be loaded. Please try again.');
      } else {
        setError(cause.message || 'Could not connect. Check your connection and retry.');
      }
    } finally {
      setLoading(false);
    }
  }, [isDevMode, signOut]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Teachers</Title>
      <Muted>Active teachers assigned to your branches</Muted>
      <ErrorText message={error} />
      {loading ? <Busy /> : !items.length ? <Empty text="No active teachers are assigned to your branches." /> : items.map(teacher => (
        <Card key={teacher._id}>
          <Label>{teacher.name}</Label>
          <Muted>{teacher.email}</Muted>
        </Card>
      ))}
      {!!error && <Button title="Retry" onPress={load} secondary />}
    </Page>
  );
}