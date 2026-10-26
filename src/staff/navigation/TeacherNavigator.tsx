import TeacherSelfServiceScreen from '../screens/teacher/TeacherSelfServiceScreen';
import TeacherLiveLessonScreen from '../screens/liveLessons/TeacherLiveLessonScreen';
import TeacherAttendanceReviewScreen from '../screens/teacher/TeacherAttendanceReviewScreen';
import TeacherAcademicScreen from '../screens/teacher/TeacherAcademicScreen';
import TeacherLessonScreen from '../screens/teacher/TeacherLessonScreen';
import TeacherDeliveryScreen from '../screens/teacher/TeacherDeliveryScreen';
import TeacherOccurrenceLessonsScreen from '../screens/teacher/TeacherOccurrenceLessonsScreen';
import TeacherHomeworkScreen from '../screens/teacher/TeacherHomeworkScreen';
import TeacherQuizScreen from '../screens/teacher/TeacherQuizScreen';
import type { LessonPlan } from '../services/teacher/academicService';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TeacherTupleIds } from '../services/teacher/teacherService';
import TeacherWorkspaceScreen from '../screens/teacher/TeacherWorkspaceScreen';
import TeacherRosterScreen from '../screens/teacher/TeacherRosterScreen';
import TeacherTimetableScreen from '../screens/teacher/TeacherTimetableScreen';
import TeacherPeriodScreen from '../screens/teacher/TeacherPeriodScreen';
import TeacherAttendanceQueueScreen from '../screens/teacher/TeacherAttendanceQueueScreen';
import TeacherAttendanceScreen from '../screens/teacher/TeacherAttendanceScreen';
import TeacherNoticeScreen from '../screens/teacher/TeacherNoticeScreen';
import TeacherWorkScreen from '../screens/teacher/TeacherWorkScreen';
import TeacherReviewQueueScreen from '../screens/teacher/TeacherReviewQueueScreen';
import TeacherReviewScreen from '../screens/teacher/TeacherReviewScreen';
import type { ReviewTargetType } from '../services/teacher/academicReviewService';
import TeacherCatchUpQueueScreen from '../screens/teacher/TeacherCatchUpQueueScreen';
import TeacherCatchUpScreen from '../screens/teacher/TeacherCatchUpScreen';
import TeacherMarksScreen from '../screens/teacher/TeacherMarksScreen';
import TeacherNotificationsScreen from '../screens/teacher/TeacherNotificationsScreen';

export type TeacherStackParamList = {
  TeacherLiveLesson: { periodId: string; date: string };
  TeacherSelfService: undefined;
  TeacherAcademic: TeacherTupleIds;
  TeacherDelivery: { lessonPlanId: string };
  TeacherOccurrenceLessons: { periodId: string; date: string };
  TeacherHomework: { lessonPlanId: string };
  TeacherQuiz: { lessonPlanId: string };
  TeacherLesson: TeacherTupleIds & {
    lesson?: LessonPlan;
    occurrence?: LessonPlan['occurrence'];
  };
  TeacherWorkspace: undefined;
  TeacherAttendanceReview: { sessionId: string; studentId: string };
  TeacherNotice: { noticeId?: string };
  TeacherWork: { workId: string };
  TeacherReviewQueue: undefined;
  TeacherReview: { targetType: ReviewTargetType; evidenceId: string };
  TeacherCatchUpQueue: undefined;
  TeacherCatchUp: { catchUpId: string };
  TeacherMarks: TeacherTupleIds;
  TeacherNotifications: undefined;
  TeacherRoster: TeacherTupleIds;
  TeacherTimetable: undefined;
  TeacherPeriod: { periodId: string; date: string };
  TeacherAttendanceQueue: undefined;
  TeacherAttendance: { periodId: string; date: string };
};
const Stack = createNativeStackNavigator<TeacherStackParamList>();

export default function TeacherNavigator() {
  return (
    <Stack.Navigator initialRouteName="TeacherWorkspace">
      <Stack.Screen
        name="TeacherLiveLesson"
        component={TeacherLiveLessonScreen}
        getId={({ params }) => params.periodId + '/' + params.date}
        options={{ title: 'Live lesson' }}
      />
      <Stack.Screen
        name="TeacherDelivery"
        component={TeacherDeliveryScreen}
        options={{ title: 'Lesson delivery' }}
      />
      <Stack.Screen
        name="TeacherOccurrenceLessons"
        component={TeacherOccurrenceLessonsScreen}
        options={{ title: 'Occurrence lessons' }}
      />
      <Stack.Screen
        name="TeacherHomework"
        component={TeacherHomeworkScreen}
        options={{ title: 'Homework' }}
      />
      <Stack.Screen
        name="TeacherQuiz"
        component={TeacherQuizScreen}
        options={{ title: 'Quiz' }}
      />
      <Stack.Screen
        name="TeacherAcademic"
        component={TeacherAcademicScreen}
        options={{ title: 'Class academics' }}
      />
      <Stack.Screen
        name="TeacherLesson"
        component={TeacherLessonScreen}
        options={{ title: 'Lesson Plan' }}
      />
      <Stack.Screen
        name="TeacherWorkspace"
        component={TeacherWorkspaceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="TeacherRoster"
        component={TeacherRosterScreen}
        options={{ title: 'Assigned roster' }}
      />
      <Stack.Screen
        name="TeacherTimetable"
        component={TeacherTimetableScreen}
        options={{ title: 'Timetable' }}
      />
      <Stack.Screen
        name="TeacherPeriod"
        component={TeacherPeriodScreen}
        options={{ title: 'Period detail' }}
      />
      <Stack.Screen
        name="TeacherAttendanceQueue"
        component={TeacherAttendanceQueueScreen}
        options={{ title: 'Attendance pending' }}
      />
      <Stack.Screen
        name="TeacherAttendance"
        component={TeacherAttendanceScreen}
        options={{ title: 'Period attendance' }}
      />
      <Stack.Screen
        name="TeacherAttendanceReview"
        component={TeacherAttendanceReviewScreen}
        options={{ title: 'Attendance review' }}
      />
      <Stack.Screen
        name="TeacherNotice"
        component={TeacherNoticeScreen}
        options={{ title: 'Notice' }}
      />
      <Stack.Screen
        name="TeacherWork"
        component={TeacherWorkScreen}
        options={{ title: 'Assigned work' }}
      />
      <Stack.Screen
        name="TeacherReviewQueue"
        component={TeacherReviewQueueScreen}
        options={{ title: 'Submissions & review' }}
      />
      <Stack.Screen
        name="TeacherReview"
        component={TeacherReviewScreen}
        options={{ title: 'Review learner evidence' }}
      />
      <Stack.Screen
        name="TeacherCatchUpQueue"
        component={TeacherCatchUpQueueScreen}
        options={{ title: 'Catch-up' }}
      />
      <Stack.Screen
        name="TeacherCatchUp"
        component={TeacherCatchUpScreen}
        options={{ title: 'Catch-up detail' }}
      />
      <Stack.Screen
        name="TeacherMarks"
        component={TeacherMarksScreen}
        options={{ title: 'Assessments & marks' }}
      />
      <Stack.Screen
        name="TeacherNotifications"
        component={TeacherNotificationsScreen}
        options={{ title: 'Notifications & preferences' }}
      />
      <Stack.Screen
        name="TeacherSelfService"
        component={TeacherSelfServiceScreen}
        options={{ title: 'Staff Self-Service' }}
      />
    </Stack.Navigator>
  );
}
