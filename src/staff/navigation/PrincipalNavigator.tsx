import RoomsScreen from '../screens/admin/RoomsScreen';
import PrincipalAttendanceReviewScreen from '../screens/principal/PrincipalAttendanceReviewScreen';
import React from 'react';
import TeacherAssignmentAdminScreen from '../screens/admin/TeacherAssignmentAdminScreen';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { ApprovalRequest } from '../services/principal/principalService';
import ApprovalDetailScreen from '../screens/principal/ApprovalDetailScreen';
import NoticeDetailScreen from '../screens/principal/NoticeDetailScreen';
import PrincipalWorkspaceScreen from '../screens/principal/PrincipalWorkspaceScreen';
import PrincipalTasksScreen from '../screens/principal/PrincipalTasksScreen';
import PrincipalTaskDetailScreen from '../screens/principal/PrincipalTaskDetailScreen';
import AssignPrincipalTaskScreen from '../screens/principal/AssignPrincipalTaskScreen';
import PrincipalSafetyOverviewScreen from '../screens/principal/PrincipalSafetyOverviewScreen';
import PrincipalSafetyDetailScreen from '../screens/principal/PrincipalSafetyDetailScreen';
import PrincipalResultsScreen from '../screens/principal/PrincipalResultsScreen';
import PrincipalResultModerationScreen from '../screens/principal/PrincipalResultModerationScreen';
import StudentEnrollmentScreen from '../screens/principal/StudentEnrollmentScreen';
import AcademicSetupScreen from '../screens/admin/AcademicSetupScreen';
import TimetableAdminScreen from '../screens/admin/TimetableAdminScreen';

export type PrincipalStackParamList = {
  Rooms: undefined;
  TimetableAdmin: undefined;
  StudentsEnrollment: undefined;
  AcademicSetup: undefined;
  AssignTeacher: {teacherId?: string} | undefined;
  PrincipalWorkspace: undefined;
  AttendanceReview: { approvalId: string };
  ApprovalDetail: { request: ApprovalRequest };
  NoticeDetail: { noticeId: string };
  Tasks: undefined;
  TaskDetail: { taskId: string; createdMessage?: string };
  AssignTask: undefined;
  SafetyOverview: undefined;
  SafetyDetail: { alertId: string };
  Results: undefined;
  ResultModeration: {approvalId: string};
};

const Stack = createNativeStackNavigator<PrincipalStackParamList>();

export default function PrincipalNavigator() {
  return (
    <Stack.Navigator initialRouteName="PrincipalWorkspace" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Rooms" component={RoomsScreen} options={{headerShown: true, title: 'Rooms', headerStyle: {backgroundColor: '#fbf9f4'}, headerTintColor: '#23595a', headerShadowVisible: false}} />
      <Stack.Screen name="TimetableAdmin" component={TimetableAdminScreen} options={{headerShown: true, title: 'Timetable Scheduling'}} />
      <Stack.Screen name="StudentsEnrollment" component={StudentEnrollmentScreen} options={{headerShown: true, title: 'Students & Enrollment', headerStyle: {backgroundColor: '#fbf9f4'}, headerTintColor: '#23595a', headerShadowVisible: false}} />
      <Stack.Screen name="AcademicSetup" component={AcademicSetupScreen} options={{headerShown: true, title: 'Academic Setup', headerStyle: {backgroundColor: '#fbf9f4'}, headerTintColor: '#23595a', headerShadowVisible: false}} />
      <Stack.Screen
        name="PrincipalWorkspace"
        component={PrincipalWorkspaceScreen}
      />
      <Stack.Screen
        name="AttendanceReview"
        component={PrincipalAttendanceReviewScreen}
      />
      <Stack.Screen name="ApprovalDetail" component={ApprovalDetailScreen} />
      <Stack.Screen name="NoticeDetail" component={NoticeDetailScreen} />
      <Stack.Screen name="Tasks" component={PrincipalTasksScreen} />
      <Stack.Screen name="TaskDetail" component={PrincipalTaskDetailScreen} />
      <Stack.Screen name="AssignTask" component={AssignPrincipalTaskScreen} />
      <Stack.Screen
        name="SafetyOverview"
        component={PrincipalSafetyOverviewScreen}
      />
      <Stack.Screen
        name="SafetyDetail"
        component={PrincipalSafetyDetailScreen}
      />
      <Stack.Screen name="AssignTeacher" component={TeacherAssignmentAdminScreen} options={{headerShown:false}} />
      <Stack.Screen name="Results" component={PrincipalResultsScreen} options={{headerShown:true,title:'Results'}} />
      <Stack.Screen name="ResultModeration" component={PrincipalResultModerationScreen} options={{headerShown:true,title:'Marks moderation'}} />
    </Stack.Navigator>
  );
}
