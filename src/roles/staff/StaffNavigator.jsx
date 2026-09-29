import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { screenOptions } from '../../navigation/screenOptions';
import PasswordScreen from '../../screens/PasswordScreen';
import StaffHome from './StaffHome';
import UsersScreen from './screens/UsersScreen';
import BranchesScreen from './screens/BranchesScreen';
import ClassesScreen from './screens/ClassesScreen';
import StaffStudentsScreen from './screens/StaffStudentsScreen';
import StaffNoticesScreen from './screens/StaffNoticesScreen';
import StaffTimetableScreen from './screens/StaffTimetableScreen';
import StaffAttendanceScreen from './screens/StaffAttendanceScreen';
import StaffAssignmentsScreen from './screens/StaffAssignmentsScreen';
import StaffAssignmentDetailScreen from './screens/StaffAssignmentDetailScreen';
import StaffLecturesScreen from './screens/StaffLecturesScreen';
import StaffLectureDetailScreen from './screens/StaffLectureDetailScreen';
import StaffInvoicesScreen from './screens/StaffInvoicesScreen';
import StaffInvoiceDetailScreen from './screens/StaffInvoiceDetailScreen';
import AuditScreen from './screens/AuditScreen';
import SettingsScreen from './screens/SettingsScreen';

const Stack = createNativeStackNavigator();
export default function StaffNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Home" component={StaffHome} options={{ title: 'Workspace' }} />
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
