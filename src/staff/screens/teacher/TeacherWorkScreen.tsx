import React, { useCallback, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import {
  Button,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import {
  communicationService,
  type TeacherWork,
} from '../../services/teacher/communicationService';
import { ApiError } from '../../services/api/apiClient';
import { useTeacherResource } from './useTeacherResource';
import { LoadState, styles } from './teacherUi';
import { workDueLabel, workSourceLabel } from './TeacherTasksScreen';

export default function TeacherWorkScreen({
  route,
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherWork'>) {
  const { accessToken } = useAuth();
  const busy = useRef(false),
    generation = useRef(0);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<TeacherWork | null>(null);
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Sign in again to open assigned work.'));
    return communicationService.work(accessToken, route.params.workId);
  }, [accessToken, route.params.workId]);
  const resource = useTeacherResource(
    load,
    'This assigned work is unavailable or was withdrawn.',
  );
  useFocusEffect(
    useCallback(() => {
      setCompleted(null);
      return () => {
        generation.current += 1;
        busy.current = false;
        setSaving(false);
      };
    }, []),
  );
  const complete = async () => {
    if (busy.current || !accessToken || !resource.data?.canComplete) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const current = generation.current;
    try {
      const result = await communicationService.complete(
        accessToken,
        route.params.workId,
      );
      if (current === generation.current) setCompleted(result);
    } catch (failure) {
      if (current !== generation.current) return;
      setError(
        failure instanceof Error ? failure.message : 'Unable to complete work.',
      );
      if (
        failure instanceof ApiError &&
        [401, 403, 404, 409].includes(failure.status)
      )
        await resource.refresh();
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setSaving(false);
      }
    }
  };
  const work = resource.data ? completed ?? resource.data : null;
  return (
    <DashboardShell refreshing={resource.loading} onRefresh={resource.refresh}>
      <Button
        title="Back"
        variant="secondary"
        onPress={() => navigation.goBack()}
      />
      <ScreenHeading
        title="Assigned work"
        subtitle="Your operational follow-up"
      />
      <LoadState
        {...resource}
        retry={resource.refresh}
        label="Loading assigned work..."
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.body}>
          {error}
        </Text>
      ) : null}
      {work ? (
        <SectionCard title={work.title}>
          <StatusBadge
            status={work.status === 'completed' ? 'paid' : 'pending'}
            label={work.status === 'completed' ? 'Completed' : 'Open'}
          />
          <Text style={styles.body}>{work.summary}</Text>
          <Text style={styles.muted}>
            {workSourceLabel(work.sourceType)} · {work.priority}
          </Text>
          <Text style={styles.muted}>{workDueLabel(work.dueAt)}</Text>
          {work.source ? (
            <Button
              title="Open class source"
              variant="secondary"
              onPress={() => navigation.navigate('TeacherRoster', work.source!)}
            />
          ) : null}
          {work.canComplete ? (
            <Button
              title={saving ? 'Completing...' : 'Complete work'}
              disabled={saving}
              onPress={complete}
            />
          ) : null}
        </SectionCard>
      ) : null}
    </DashboardShell>
  );
}
