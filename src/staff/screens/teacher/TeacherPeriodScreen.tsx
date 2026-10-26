import React, { useCallback, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import {
  Button,
  Card,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { timetableService } from '../../services/teacher/timetableService';
import { useTeacherResource } from './useTeacherResource';
import { useTimetableAction } from './useTimetableAction';
import { PeriodSummary, TimetableState, timetableStyles } from './timetableUi';

export default function TeacherPeriodScreen({
  route,
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherPeriod'>) {
  const { accessToken, user } = useAuth(),
    { periodId, date } = route.params;
  const [reason, setReason] = useState(''),
    [validation, setValidation] = useState<string | null>(null);
  // Identity is a retry token, never an authorization credential.
  const operation = useRef<{
    id: string;
    reason: string;
    context: string;
  } | null>(null);
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Authentication required.'));
    return timetableService.getPeriod(accessToken, periodId, date);
  }, [accessToken, periodId, date]);
  const resource = useTeacherResource(
    load,
    'This timetable period is unavailable or you no longer have access.',
  );
  const action = useTimetableAction(
    `${accessToken}/${periodId}/${date}`,
    resource.refresh,
  );
  const period = resource.data;
  return (
    <DashboardShell
      safeArea={false}
      refreshing={resource.loading}
      onRefresh={() => {
        resource.refresh();
      }}
    >
      <ScreenHeading title="Period detail" subtitle={date} />
      <TimetableState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
      />
      {action.error ? (
        <Text accessibilityRole="alert" style={timetableStyles.body}>
          {action.error}
        </Text>
      ) : null}
      {action.notice ? (
        <Text style={timetableStyles.body}>{action.notice}</Text>
      ) : null}
      {period ? (
        <Card>
          <PeriodSummary period={period} />
          {hasPermission(user?.role, PERMISSIONS.LIVE_LESSON_START) ? <Button title="Open live lesson" onPress={() => navigation.navigate('TeacherLiveLesson', {periodId, date})} /> : null}
          <Button title="Occurrence Lessons" variant="secondary" onPress={() => navigation.navigate('TeacherOccurrenceLessons', {periodId, date})} />
          {!period.isSubstitute ? <Button title="Plan Lesson for Period" variant="secondary" onPress={() => navigation.navigate('TeacherLesson', {
            classId: period.classId, sectionId: period.sectionId, subjectId: period.subjectId,
            occurrence: {periodId, date, timetableVersionId: period.approvedVersion.versionId},
          })} /> : null}
          {hasPermission(user?.role, PERMISSIONS.TEACHER_ATTENDANCE_VIEW) ? (
            <Button
              title="Open attendance"
              onPress={() =>
                navigation.navigate('TeacherAttendance', { periodId, date })
              }
            />
          ) : null}
          {period.canAcknowledgeSubstitute ? (
            <Button
              title="Acknowledge substitute"
              disabled={action.pending}
              onPress={() => {
                action.run(
                  () =>
                    timetableService.acknowledge(accessToken!, periodId, date),
                  'Substitute acknowledgement confirmed.',
                );
              }}
            />
          ) : null}
        </Card>
      ) : null}
      {period?.canRequestIssue ? (
        <SectionCard title="Request a timetable issue">
          <Text style={timetableStyles.muted}>
            Report a scheduling issue. This does not edit the timetable. Avoid
            student or guardian private information.
          </Text>
          <TextInput
            accessibilityLabel="Issue reason"
            placeholder="Reason (required, up to 500 characters)"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={500}
            editable={!action.pending}
            style={timetableStyles.input}
          />
          {validation ? (
            <Text accessibilityRole="alert" style={timetableStyles.body}>
              {validation}
            </Text>
          ) : null}
          <Button
            title="Submit issue"
            disabled={action.pending}
            onPress={async () => {
              const trimmed = reason.trim();
              if (!trimmed || trimmed.length > 500) {
                setValidation('Enter a reason between 1 and 500 characters.');
                return;
              }
              setValidation(null);
              if (
                !operation.current ||
                operation.current.reason !== trimmed ||
                operation.current.context !==
                  accessToken + '/' + periodId + '/' + date
              ) {
                operation.current = {
                  reason: trimmed,
                  context: accessToken + '/' + periodId + '/' + date,
                  id:
                    Date.now().toString(36) +
                    '_' +
                    Array.from({ length: 4 }, () =>
                      Math.random().toString(36).slice(2, 12).padEnd(10, '0'),
                    ).join(''),
                };
              }
              const submitted = operation.current;
              if (
                await action.run(
                  () =>
                    timetableService.requestIssue(
                      accessToken!,
                      periodId,
                      date,
                      trimmed,
                      submitted.id,
                    ),
                  'Issue request confirmed.',
                )
              ) {
                if (operation.current === submitted) operation.current = null;
                setReason('');
              }
            }}
          />
        </SectionCard>
      ) : null}
    </DashboardShell>
  );
}
