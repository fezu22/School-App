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
import { hasPermission, PERMISSIONS } from '../../constants/permissions';

export default function TeacherInboxScreen({
  active,
  onOpen,
}: {
  active: boolean;
  onOpen: (noticeId?: string) => void;
}) {
  const { accessToken, user } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Sign in again to open Inbox.'));
    return communicationService.inbox(accessToken, offset);
  }, [accessToken, offset]);
  const resource = useTeacherResource(
    load,
    'This notice is no longer available.',
    active,
  );
  return (
    <DashboardShell
      safeArea={false}
      refreshing={resource.loading}
      onRefresh={resource.refresh}
    >
      <ScreenHeading
        title="Inbox"
        subtitle="School notices and your class announcements"
      />
      {hasPermission(user?.role, PERMISSIONS.TEACHER_NOTICES_MANAGE) ? (
        <Button title="Draft notice" onPress={() => onOpen()} />
      ) : null}
      <LoadState
        {...resource}
        retry={resource.refresh}
        label="Loading notices..."
      />
      {resource.data ? (
        <Text style={styles.muted}>
          {resource.data.total} notices and drafts
        </Text>
      ) : null}
      {resource.data?.items.length === 0 ? (
        <Text style={styles.body}>
          No notices or drafts in your current Inbox.
        </Text>
      ) : null}
      {resource.data?.items.map(notice => (
        <Card
          key={notice.noticeId}
          style={selected === notice.noticeId ? styles.selected : undefined}
        >
          <StatusBadge
            status={notice.state === 'published' ? 'paid' : 'pending'}
            label={notice.state === 'draft' ? 'Draft' : 'Notice'}
          />
          <Text style={styles.body}>{notice.title}</Text>
          <Text style={styles.muted}>
            {notice.kind === 'school_notice'
              ? 'School notice'
              : 'Class announcement'}
          </Text>
          {notice.deliveryState ? (
            <Text style={styles.muted}>
              Published internally in the school app
            </Text>
          ) : null}
          <Button
            title={`Open ${notice.title}`}
            variant="secondary"
            onPress={() => {
              setSelected(notice.noticeId);
              onOpen(notice.noticeId);
            }}
          />
        </Card>
      ))}
      {offset > 0 ? (
        <Button
          title="Previous notices"
          variant="secondary"
          onPress={() => setOffset(Math.max(0, offset - 50))}
        />
      ) : null}
      {resource.data?.nextOffset != null ? (
        <Button
          title="Next notices"
          variant="secondary"
          onPress={() => setOffset(resource.data!.nextOffset!)}
        />
      ) : null}
      <Text style={styles.muted}>
        Private questions and replies are not available yet.
      </Text>
    </DashboardShell>
  );
}
