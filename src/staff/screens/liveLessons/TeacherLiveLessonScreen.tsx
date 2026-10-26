import React, { useMemo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import LiveLessonRoomScreen from './LiveLessonRoomScreen';
export default function TeacherLiveLessonScreen({
  route,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherLiveLesson'>) {
  const { periodId, date } = route.params;
  const target = useMemo(
    () => ({ kind: 'teacher' as const, periodId, date }),
    [periodId, date],
  );
  return <LiveLessonRoomScreen target={target} />;
}
