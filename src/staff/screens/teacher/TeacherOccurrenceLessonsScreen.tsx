import React, { useCallback } from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  DashboardShell,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { formStyles } from '../../components/hiraDashboard/AdminForm';
import { academicService } from '../../services/teacher/academicService';
import { useTeacherResource } from './useTeacherResource';
import { LoadState } from './teacherUi';
export default function TeacherOccurrenceLessonsScreen({
  route,
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherOccurrenceLessons'>) {
  const { accessToken } = useAuth();
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Authentication required'));
    return academicService.occurrenceLessons(
      accessToken,
      route.params.periodId,
      route.params.date,
    );
  }, [accessToken, route.params.periodId, route.params.date]);
  const resource = useTeacherResource(load);
  return (
    <DashboardShell safeArea={false}>
      <ScreenHeading
        title="Approved Occurrence Lessons"
        subtitle={route.params.date}
      />
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
        label="Loading occurrence lessons..."
      />
      {resource.data?.length === 0 ? (
        <Text style={formStyles.copy}>
          No approved lesson is linked to this occurrence. Attendance authority
          does not create delivery authority.
        </Text>
      ) : null}
      {resource.data?.map(lesson => (
        <SectionCard key={lesson.lessonPlanId} title={lesson.teachingDate}>
          <Text style={formStyles.copy}>{lesson.objectives}</Text>
          <Button
            title="Record Delivery"
            onPress={() =>
              navigation.navigate('TeacherDelivery', {
                lessonPlanId: lesson.lessonPlanId,
              })
            }
          />
        </SectionCard>
      ))}
    </DashboardShell>
  );
}
