import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { screenOptions } from '../../navigation/screenOptions';
import PasswordScreen from '../../screens/PasswordScreen';
import TeacherHome from './TeacherHome';
import UsersScreen from '../staff/screens/UsersScreen';
import BranchesScreen from '../staff/screens/BranchesScreen';
import ClassesScreen from '../staff/screens/ClassesScreen';
import StaffStudentsScreen from '../staff/screens/StaffStudentsScreen';
import StaffNoticesScreen from '../staff/screens/StaffNoticesScreen';
import StaffTimetableScreen from '../staff/screens/StaffTimetableScreen';
import StaffAttendanceScreen from '../staff/screens/StaffAttendanceScreen';
import StaffAssignmentsScreen from '../staff/screens/StaffAssignmentsScreen';
import StaffAssignmentDetailScreen from '../staff/screens/StaffAssignmentDetailScreen';
import StaffLecturesScreen from '../staff/screens/StaffLecturesScreen';
import StaffLectureDetailScreen from '../staff/screens/StaffLectureDetailScreen';
import StaffInvoicesScreen from '../staff/screens/StaffInvoicesScreen';
import StaffInvoiceDetailScreen from '../staff/screens/StaffInvoiceDetailScreen';
import AuditScreen from '../staff/screens/AuditScreen';
import SettingsScreen from '../staff/screens/SettingsScreen';

const Stack = createNativeStackNavigator();
export default function TeacherNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Home" component={TeacherHome} options={{ title: 'Teacher' }} />
      <Stack.Screen name="Users" component={UsersScreen} />
      <Stack.Screen name="Branches" component={BranchesScreen} />
      <Stack.Screen name="Classes" component={ClassesScreen} />
      <Stack.Screen name="Students" component={StaffStudentsScreen} />
      <Stack.Screen name="Notices" component={StaffNoticesScreen} />
      <Stack.Screen name="Timetable" component={StaffTimetableScreen} />
      <Stack.Screen name="Attendance" component={StaffAttendanceScreen} />
      <Stack.Screen name="Assignments" component={StaffAssignmentsScreen} />
      <Stack.Screen name="AssignmentDetail" component={StaffAssignmentDetailScreen} options={{ title: 'Assignment' }} />
      <Stack.Screen name="Lectures" component={StaffLecturesScreen} options={{ title: 'AI learning' }} />
      <Stack.Screen name="LectureDetail" component={StaffLectureDetailScreen} options={{ title: 'Lesson' }} />
      <Stack.Screen name="Invoices" component={StaffInvoicesScreen} options={{ title: 'Fees & receipts' }} />
      <Stack.Screen name="InvoiceDetail" component={StaffInvoiceDetailScreen} options={{ title: 'Invoice & receipts' }} />
      <Stack.Screen name="Audit" component={AuditScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Password" component={PasswordScreen} />
    </Stack.Navigator>
  );
}
