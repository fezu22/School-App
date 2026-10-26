import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import {
  Button,
  Card,
  ScreenHeading,
  StatusBadge,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import { communicationService } from '../../services/teacher/communicationService';
import { useTeacherResource } from './useTeacherResource';
import { LoadState, styles } from './teacherUi';

export const workSourceLabel = (source: string) =>
  source === 'class_follow_up' ? 'Class follow-up' : 'Coordinator follow-up';
export const workDueLabel = (due: string | null) =>
  !due
    ? 'No due date'
    : `${Date.parse(due) < Date.now() ? 'Overdue' : 'Due'} · ${new Date(
        due,
      ).toLocaleDateString()}`;
export default function TeacherTasksScreen({
  active,
  onOpen,
  onOpenReviews,
  onOpenCatchUps,
}: {
  active: boolean;
  onOpen: (workId: string) => void;
  onOpenReviews?: () => void;
  onOpenCatchUps?: () => void;
}) {
  const { accessToken } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Sign in again to open assigned work.'));
    return communicationService.tasks(accessToken, offset);
  }, [accessToken, offset]);
  const resource = useTeacherResource(
    load,
    'This assigned work is no longer available.',
    active,
  );
  return (
    <DashboardShell
      safeArea={false}
      refreshing={resource.loading}
      onRefresh={resource.refresh}
    >
      <ScreenHeading
        title="Assigned work"
        subtitle="Operational work assigned to you"
      />
      {onOpenReviews ? <Button title="Open Submissions & Review" onPress={onOpenReviews} /> : null}
      {onOpenCatchUps ? <Button title="Open Catch-up" onPress={onOpenCatchUps} /> : null}
      <LoadState
        {...resource}
        retry={resource.refresh}
        label="Loading assigned work..."
      />
      {resource.data ? (
        <Text style={styles.muted}>{resource.data.total} open items</Text>
      ) : null}
      {resource.data?.items.length === 0 ? (
        <Text style={styles.body}>No current assigned work.</Text>
      ) : null}
      {resource.data?.items.map(work => (
        <Card
          key={work.workId}
          style={selected === work.workId ? styles.selected : undefined}
        >
          <StatusBadge status="pending" label="Open" />
          <Text style={styles.body}>{work.title}</Text>
          <Text style={styles.muted}>
            {workSourceLabel(work.sourceType)} ·{' '}
            {work.priority === 'high' ? 'High priority' : 'Normal priority'}
          </Text>
          <Text style={styles.muted}>{workDueLabel(work.dueAt)}</Text>
          <Button
            title={`Open ${work.title}`}
            variant="secondary"
            onPress={() => {
              setSelected(work.workId);
              onOpen(work.workId);
            }}
          />
        </Card>
      ))}
      {offset > 0 ? (
        <Button
          title="Previous work"
          variant="secondary"
          onPress={() => setOffset(Math.max(0, offset - 50))}
        />
      ) : null}
      {resource.data?.nextOffset != null ? (
        <Button
          title="Next work"
          variant="secondary"
          onPress={() => setOffset(resource.data!.nextOffset!)}
        />
      ) : null}
    </DashboardShell>
  );
}
