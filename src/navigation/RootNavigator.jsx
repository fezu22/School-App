import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { useParentChild } from '../auth/ParentChildContext';
import { Busy, Card, Muted, Page, Title } from '../components/UI';
import { colors } from '../theme';
import LoginScreen from '../screens/LoginScreen';
import PasswordScreen from '../screens/PasswordScreen';
import HomeScreen from '../screens/HomeScreen';
import RecordsScreen from '../screens/RecordsScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import AssignmentsScreen from '../screens/AssignmentsScreen';
import AssignmentDetailScreen from '../screens/AssignmentDetailScreen';
import InvoiceDetailScreen from '../screens/InvoiceDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import LecturesScreen from '../screens/LecturesScreen';
import LectureDetailScreen from '../screens/LectureDetailScreen';
import ModuleHubScreen from '../screens/ModuleHubScreen';
import ProfileScreen from '../screens/ProfileScreen';
import CashClosingScreen from '../screens/CashClosingScreen';
import { MODULES, ROLES_BY_SCREEN } from './modules';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

function GuardedRoute({ routeName, component: Screen, ...props }) {
  const { user } = useAuth();
  const allowed = ROLES_BY_SCREEN[routeName] || [];
  if (!user || !allowed.includes(user.role)) {
    return (
      <Page>
        <Card>
          <Title>Section unavailable</Title>
          <Muted>This section is not enabled for your account role.</Muted>
        </Card>
      </Page>
    );
  }
  return <Screen {...props} />;
}

const Screen = (routeName, component) => props =>
  <GuardedRoute routeName={routeName} component={component} {...props} />;

function MainTabs() {
  const { user } = useAuth();
  const hasGroup = group =>
    MODULES.some(
      item => item.group === group && item.roles.includes(user.role),
    );
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarItemStyle: { minHeight: 52, paddingVertical: 5 },
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.border,
          minHeight: 60,
        },
      }}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Home', tabBarAccessibilityLabel: 'Home tab' }}
      />
      {hasGroup('Learning') && (
        <Tabs.Screen
          name="Learning"
          component={ModuleHubScreen}
          options={{ title: 'Learning' }}
        />
      )}
      {hasGroup('Records') && (
        <Tabs.Screen
          name="Records"
          component={ModuleHubScreen}
          options={{ title: 'Records' }}
        />
      )}
      <Tabs.Screen
        name="More"
        component={ModuleHubScreen}
        options={{ title: 'More' }}
      />
    </Tabs.Navigator>
  );
}

const moduleScreens = {
  Attendance: [AttendanceScreen, 'Attendance'],
  Assignments: [AssignmentsScreen, 'Assignments'],
  AssignmentDetail: [AssignmentDetailScreen, 'AssignmentDetail'],
  Lectures: [LecturesScreen, 'Lectures'],
  LectureDetail: [LectureDetailScreen, 'LectureDetail'],
  InvoiceDetail: [InvoiceDetailScreen, 'InvoiceDetail'],
  Settings: [SettingsScreen, 'Settings'],
  Password: [PasswordScreen, 'Password'],
  Profile: [ProfileScreen, 'Profile'],
  CashClosing: [CashClosingScreen, 'CashClosing'],
  Users: [RecordsScreen, 'Users'],
  Branches: [RecordsScreen, 'Branches'],
  Classes: [RecordsScreen, 'Classes'],
  Students: [RecordsScreen, 'Students'],
  Notices: [RecordsScreen, 'Notices'],
  Timetable: [RecordsScreen, 'Timetable'],
  Invoices: [RecordsScreen, 'Invoices'],
  Audit: [RecordsScreen, 'Audit'],
};
const guardedModuleScreens = Object.fromEntries(
  Object.entries(moduleScreens).map(([name, [component, accessKey]]) => [
    name,
    Screen(accessKey, component),
  ]),
);
const GuardedPasswordScreen = Screen('Password', PasswordScreen);

export default function RootNavigator() {
  const { user, loading } = useAuth();
  const { selectedChildId } = useParentChild();
  if (loading) return <Busy />;
  return (
    <NavigationContainer
      key={`${user?._id || 'guest'}:${
        user?.role === 'PARENT' ? selectedChildId : ''
      }`}
    >
      <Stack.Navigator
        screenOptions={{
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        {!user ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        ) : user.mustChangePassword ? (
          <Stack.Screen
            name="Password"
            component={GuardedPasswordScreen}
            options={{ title: 'Change password', headerBackVisible: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Workspace"
              component={MainTabs}
              options={{ headerShown: false }}
            />
            {Object.entries(moduleScreens).map(([name, [, accessKey]]) => {
              const roles = ROLES_BY_SCREEN[accessKey] || [];
              if (!roles.includes(user.role)) return null;
              return (
                <Stack.Screen
                  key={name}
                  name={name}
                  component={guardedModuleScreens[name]}
                  options={{
                    title:
                      name === 'Lectures'
                        ? 'Learning'
                        : name === 'InvoiceDetail'
                        ? 'Invoice & receipts'
                        : name,
                  }}
                />
              );
            })}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
