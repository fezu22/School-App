import React, { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  HeroBanner,
  StatusBadge,
} from '../../components/hiraDashboard';
import {
  DashboardShell,
  DashboardStateCard,
} from '../../components/hiraDashboard/DashboardShell';
import { colors, spacing, typography } from '../../theme/hiraDashboard';
import { useAuth } from '../../context/AuthContext';
import {
  homeService,
  type TeacherHome,
  type TeacherHomeAction,
} from '../../services/teacher/homeService';
import { useTeacherResource } from './useTeacherResource';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';

const timeLabel = (clock: string) => {
  const [hour, minute] = clock.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${
    hour < 12 ? 'AM' : 'PM'
  }`;
};
export const heroContext = (hero: TeacherHome['hero']) => {
  const period = hero.currentOrNextPeriod;
  if (period)
    return `${hero.state === 'current' ? 'Now teaching' : 'Next period'}: ${
      period.className
    } · Section ${period.sectionName} · ${period.subjectName}\n${
      period.room
    } · ${timeLabel(period.startTime)}–${timeLabel(period.endTime)}${
      period.isSubstitute ? ' · Substitute duty' : ''
    }`;
  return hero.state === 'finished'
    ? `${hero.periodCount} period${
        hero.periodCount === 1 ? '' : 's'
      } scheduled today. No more periods today.`
    : 'No periods scheduled today.';
};
export default function TeacherHomeScreen({
  onAction,
  onOpenLiveLesson,
}: {
  onAction: (action: TeacherHomeAction) => void;
  onOpenLiveLesson?: (occurrence: {periodId: string; date: string}) => void;
}) {
  const { user, accessToken } = useAuth();
  const load = useCallback(() => {
    if (!accessToken || !user?.id || user.role !== 'teacher')
      return Promise.reject(new Error('Sign in again to open Teacher Home.'));
    return homeService.getHome(accessToken);
  }, [accessToken, user?.role, user?.id]);
  const resource = useTeacherResource(
    load,
    'Teacher Home is unavailable or your access has changed. Please retry.',
  );
  const { refresh } = resource;
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        refresh();
      }, 60000);
      return () => clearInterval(timer);
    }, [refresh]),
  );
  const data = resource.data;
  const action = data?.primaryAction;
  return (
    <DashboardShell
      safeArea={false}
      refreshing={resource.loading}
      onRefresh={resource.refresh}
    >
      <DashboardStateCard
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.refresh}
      />
      {data ? (
        <>
          <View accessibilityRole="header">
            <HeroBanner
              roleLabel="TEACHER"
              dateLabel={new Date(
                `${data.schoolDate}T12:00:00Z`,
              ).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                timeZone: 'UTC',
              })}
              title={`${data.hero.greeting}, ${data.teacher.fullName}`}
              subtitle={heroContext(data.hero)}
            />
          </View>
          {user?.role === 'teacher' && hasPermission(user.role, PERMISSIONS.LIVE_LESSON_START) && onOpenLiveLesson ? (
            <Card>
              <Text accessibilityRole="header" style={homeStyles.title}>Live Lesson</Text>
              <Text style={homeStyles.copy}>
                {data.hero.currentOrNextPeriod
                  ? 'Preview your current or next lesson before starting live.'
                  : 'No live lesson is available to start right now.'}
              </Text>
              <Button
                title="Go Live"
                disabled={!data.hero.currentOrNextPeriod}
                style={homeStyles.action}
                onPress={() => {
                  const period = data.hero.currentOrNextPeriod;
                  if (period) onOpenLiveLesson({periodId: period.periodId, date: period.date});
                }}
              />
            </Card>
          ) : null}
          <Card>
            <StatusBadge
              status={action ? 'pending' : 'paid'}
              label={action ? 'Needs attention' : 'Up to date'}
            />
            <Text accessibilityRole="header" style={homeStyles.title}>
              {action?.type === 'attendance'
                ? 'Attendance Pending'
                : action?.type === 'work'
                ? 'Urgent Assigned Work'
                : action?.type === 'notice'
                ? 'Important Notice'
                : 'You’re all caught up'}
            </Text>
            <Text style={homeStyles.copy}>
              {action?.type === 'attendance'
                ? `${action.count} period${
                    action.count === 1 ? '' : 's'
                  } still need${action.count === 1 ? 's' : ''} attendance.`
                : action?.type === 'work'
                ? `${action.count} open task${
                    action.count === 1 ? '' : 's'
                  }. High-priority or overdue work needs your attention.`
                : action?.type === 'notice'
                ? action.title
                : 'No urgent teaching actions need your attention right now.'}
            </Text>
            {action ? (
              <Button
                title={
                  action.type === 'attendance'
                    ? 'Mark Attendance'
                    : action.type === 'work'
                    ? 'Review Tasks'
                    : 'Open Inbox'
                }
                onPress={() => onAction(action)}
                style={homeStyles.action}
              />
            ) : null}
          </Card>
        </>
      ) : null}
    </DashboardShell>
  );
}
const homeStyles = StyleSheet.create({
  title: { ...typography.h3, color: colors.ink, marginTop: spacing.md },
  copy: { ...typography.body, color: colors.muted, marginTop: spacing.sm },
  action: { marginTop: spacing.lg },
});
