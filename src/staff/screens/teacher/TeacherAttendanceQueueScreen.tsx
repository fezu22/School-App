import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import {
  Button,
  Card,
  ScreenHeading,
  StatusBadge,
} from '../../components/hiraDashboard';
import { attendanceService } from '../../services/teacher/attendanceService';
import { useTeacherResource } from './useTeacherResource';
import { PeriodSummary, TimetableState, timetableStyles } from './timetableUi';
export default function TeacherAttendanceQueueScreen({
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherAttendanceQueue'>) {
  const { accessToken } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Authentication required.'));
    return attendanceService.getPending(accessToken);
  }, [accessToken]);
  const resource = useTeacherResource(
    load,
    'Attendance is unavailable or you no longer have access.',
  );
  return (
    <DashboardShell
      safeArea={false}
      refreshing={resource.loading}
      onRefresh={() => {
        resource.refresh();
      }}
    >
      <ScreenHeading
        title="Attendance pending"
        subtitle={resource.data?.date ?? 'Current school date'}
      />
      <Text style={timetableStyles.muted}>
        Pending means attendance has not been submitted. It does not indicate
        student absence.
      </Text>
      <TimetableState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
      />
      {resource.data?.sessions.length === 0 ? (
        <Text style={timetableStyles.body}>
          No attendance sessions are pending for this date.
        </Text>
      ) : null}
      {resource.data?.sessions.map(item => (
        <Card key={`${item.period.periodId}/${item.period.date}`}>
          <PeriodSummary period={item.period} />
          <StatusBadge
            status="pending"
            label={item.state === 'draft' ? 'Draft' : 'Open'}
          />
          {selected === `${item.period.periodId}/${item.period.date}` ? (
            <Text style={timetableStyles.muted}>Selected occurrence</Text>
          ) : null}
          <Button
            title="Open attendance"
            onPress={() => {
              setSelected(`${item.period.periodId}/${item.period.date}`);
              navigation.navigate('TeacherAttendance', {
                periodId: item.period.periodId,
                date: item.period.date,
              });
            }}
          />
        </Card>
      ))}
    </DashboardShell>
  );
}
