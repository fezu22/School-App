/* eslint-disable no-void -- Event handlers detach requests with local error handling. */
import React, { useCallback, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { StudentStackParamList } from '../../navigation/StudentNavigator';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, ScreenHeading } from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import {
  liveLessonService,
  liveLessonError,
  type LiveLesson,
} from '../../services/liveLessons/liveLessonService';
export default function StudentLiveLessonsScreen({
  navigation,
}: NativeStackScreenProps<StudentStackParamList, 'StudentLiveLessons'>) {
  const { accessToken, logout } = useAuth();
  const [sessions, setSessions] = useState<LiveLesson[]>([]),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  const navigationPending = useRef(false);
  const active = useRef(false),
    generation = useRef(0);
  const load = useCallback(async () => {
    if (!accessToken || !active.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    setSessions([]);
    try {
      const result = await liveLessonService.available(accessToken);
      if (active.current && request === generation.current)
        setSessions(result.sessions);
    } catch (cause) {
      if (active.current && request === generation.current)
        setError(liveLessonError(cause));
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [accessToken]);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      navigationPending.current = false;
      void load();
      return () => {
        active.current = false;
        generation.current++;
      };
    }, [load]),
  );
  return (
    <DashboardShell
      refreshing={loading}
      onRefresh={() => {
        void load();
      }}
    >
      <ScreenHeading
        title="Live lessons"
        subtitle="Your current enrolled class"
      />
      {error ? (
        <Card>
          <Text accessibilityRole="alert">{error}</Text>
          <Button
            title="Retry"
            onPress={() => {
              void load();
            }}
          />
        </Card>
      ) : null}
      {!loading && !error && !sessions.length ? (
        <Card>
          <Text>
            No live lessons are available. Your teacher must start the lesson,
            and an active school enrollment is required.
          </Text>
        </Card>
      ) : null}
      {sessions.map(session => (
        <Card key={session.id}>
          <Text>
            {session.subjectName} · {session.className} {session.sectionName}
          </Text>
          <Text>
            {new Date(session.scheduledStart).toLocaleString()} · Live
          </Text>
          <Button
            title="Open live lesson"
            onPress={() => {
              if (navigationPending.current) return;
              navigationPending.current = true;
              navigation.navigate('StudentLiveRoom', { sessionId: session.id });
            }}
          />
        </Card>
      ))}
      <Button
        title="Sign out"
        variant="secondary"
        onPress={() => {
          void logout().catch(() => undefined);
        }}
      />
    </DashboardShell>
  );
}
