import RoomsScreen from '../screens/admin/RoomsScreen';
import React from 'react';
import TimetableAdminScreen from '../screens/admin/TimetableAdminScreen';
import AcademicSetupScreen from '../screens/admin/AcademicSetupScreen';
import TeacherAssignmentAdminScreen from '../screens/admin/TeacherAssignmentAdminScreen';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import SuperAdminDashboardScreen from '../screens/superAdmin/SuperAdminDashboardScreen';
import SuperAdminBranchDetailsScreen from '../screens/superAdmin/SuperAdminBranchDetailsScreen';
import CreatePrincipalScreen from '../screens/superAdmin/CreatePrincipalScreen';
import CreateTeacherScreen from '../screens/superAdmin/CreateTeacherScreen';
import SuperAdminSettingsScreen from '../screens/superAdmin/SuperAdminSettingsScreen';
export type SuperAdminStackParamList = {
  Rooms: undefined;
  TimetableAdmin: undefined;
  AcademicSetup: undefined;
  AssignTeacher: {teacherId?: string} | undefined;
  SuperAdminDashboard: undefined;
  SuperAdminSettings: undefined;
  CreatePrincipal: undefined;
  CreateTeacher: undefined;
  SuperAdminBranchDetails: { branchId: string };
};

const Stack = createNativeStackNavigator<SuperAdminStackParamList>();

const SuperAdminNavigator = () => {
  return (
    <Stack.Navigator initialRouteName="SuperAdminDashboard">
      <Stack.Screen name="Rooms" component={RoomsScreen} options={{headerShown: true, title: 'Rooms', headerStyle: {backgroundColor: '#fbf9f4'}, headerTintColor: '#23595a', headerShadowVisible: false}} />
      <Stack.Screen name="TimetableAdmin" component={TimetableAdminScreen} options={{title: 'Timetable Scheduling'}} />
      <Stack.Screen name="AcademicSetup" component={AcademicSetupScreen} options={{title: 'Academic Setup', headerStyle: {backgroundColor: '#fbf9f4'}, headerTintColor: '#23595a', headerShadowVisible: false}} />
      <Stack.Screen name="CreateTeacher" component={CreateTeacherScreen}
        options={{title: 'Create Teacher', headerStyle: {backgroundColor: '#fbf9f4'},
          headerTintColor: '#23595a', headerShadowVisible: false}} />
      <Stack.Screen
        name="SuperAdminDashboard"
        component={SuperAdminDashboardScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="SuperAdminSettings"
        component={SuperAdminSettingsScreen}
        options={{
          title: 'Settings',
          headerStyle: { backgroundColor: '#fbf9f4' },
          headerTintColor: '#23595a',
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: 'Nunito-Bold', fontSize: 18 },
        }}
      />
      <Stack.Screen
        name="SuperAdminBranchDetails"
        component={SuperAdminBranchDetailsScreen}
        options={{
          title: 'Branch details',
          headerStyle: { backgroundColor: '#fbf9f4' },
          headerTintColor: '#23595a',
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: 'Nunito-Bold', fontSize: 18 },
        }}
      />
      <Stack.Screen
        name="CreatePrincipal"
        component={CreatePrincipalScreen}
        options={{
          title: 'Create Principal',
          headerStyle: { backgroundColor: '#fbf9f4' },
          headerTintColor: '#23595a',
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: 'Nunito-Bold', fontSize: 18 },
        }}
      />
      <Stack.Screen name="AssignTeacher" component={TeacherAssignmentAdminScreen} options={{headerShown:false}} />
    </Stack.Navigator>
  );
};

export default SuperAdminNavigator;
