import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { teacherService } from '../../services/teacher/teacherService';
import TeacherClassesScreen from './TeacherClassesScreen';
import TeacherInboxScreen from './TeacherInboxScreen';
import TeacherTasksScreen from './TeacherTasksScreen';
import { useTeacherResource } from './useTeacherResource';
import { TeacherButton, styles } from './teacherUi';
import TeacherHomeScreen from './TeacherHomeScreen';
import {AdminDialog} from '../../components/hiraDashboard/AdminForm';

export const teacherDestinations = [
  'Home',
  'Classes',
  'Tasks',
  'Inbox',
  'Me',
] as const;
type Destination = (typeof teacherDestinations)[number];

export default function TeacherWorkspaceScreen({
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherWorkspace'>) {
  const { user, accessToken, logout } = useAuth();
  const [destination, setDestination] = useState<Destination>('Home');
  const [visited, setVisited] = useState({ Inbox: false, Tasks: false });
  const [confirmLogout,setConfirmLogout]=useState(false);
  const canViewClasses = hasPermission(
    user?.role,
    PERMISSIONS.TEACHER_CLASSES_VIEW,
  );
  const load = useCallback(() => {
    if (!accessToken || !canViewClasses)
      return Promise.reject(new Error('Class access is unavailable.'));
    return teacherService.getAssignedClasses(accessToken);
  }, [accessToken, canViewClasses]);
  const resource = useTeacherResource(load);
  const openTab = (tab: Destination) => {
    if (tab === 'Inbox' || tab === 'Tasks')
      setVisited(previous => ({ ...previous, [tab]: true }));
    setDestination(tab);
  };
  return (
    <SafeAreaView style={styles.shell}>
      <View style={[styles.page, destination !== 'Classes' && styles.hidden]}>
        {canViewClasses ? (
          <TeacherClassesScreen
            onOpenTimetable={
              hasPermission(user?.role, PERMISSIONS.TEACHER_TIMETABLE_VIEW)
                ? () => navigation.navigate('TeacherTimetable')
                : undefined
            }
            assignments={resource.data}
            loading={resource.loading}
            error={resource.error}
            refresh={resource.refresh}
            onOpenRoster={ids => navigation.navigate('TeacherRoster', ids)}
            onOpenAcademic={ids => navigation.navigate('TeacherAcademic', ids)}
          />
        ) : (
          <Text style={styles.body}>Class access is unavailable.</Text>
        )}
      </View>
      {visited.Inbox ? (
        <View style={[styles.page, destination !== 'Inbox' && styles.hidden]}>
          <TeacherInboxScreen
            active={destination === 'Inbox'}
            onOpen={noticeId =>
              navigation.navigate('TeacherNotice', { noticeId })
            }
          />
        </View>
      ) : null}
      {visited.Tasks ? (
        <View style={[styles.page, destination !== 'Tasks' && styles.hidden]}>
          <TeacherTasksScreen
            active={destination === 'Tasks'}
            onOpen={workId => navigation.navigate('TeacherWork', { workId })}
            onOpenReviews={() => navigation.navigate('TeacherReviewQueue')}
            onOpenCatchUps={() => navigation.navigate('TeacherCatchUpQueue')}
          />
        </View>
      ) : null}
      {destination === 'Home' ? (
        <TeacherHomeScreen
          onOpenLiveLesson={user?.role === 'teacher' && hasPermission(user.role, PERMISSIONS.LIVE_LESSON_START)
            ? occurrence => navigation.navigate('TeacherLiveLesson', occurrence)
            : undefined}
          onAction={action => {
            if (action.type === 'attendance')
              navigation.navigate('TeacherAttendanceQueue');
            else openTab(action.routeTarget);
          }}
        />
      ) : null}
      {destination === 'Me' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Me</Text>
          <Text style={styles.body}>{user?.fullName}</Text>
          <Text style={styles.muted}>Teacher</Text>
          <Text style={styles.body}>{user?.email}</Text>
          <TeacherButton title="Notifications & Preferences" onPress={()=>navigation.navigate('TeacherNotifications')} />
          {hasPermission(user?.role, PERMISSIONS.STAFF_SELF_SERVICE_VIEW) ? <TeacherButton title="Staff Self-Service" onPress={() => navigation.navigate('TeacherSelfService')} /> : null}
          <TeacherButton title="Log out" onPress={()=>setConfirmLogout(true)} />
          <AdminDialog visible={confirmLogout} title="Log out of this device?" confirmTitle="Log out" danger onClose={()=>setConfirmLogout(false)} onConfirm={()=>{setConfirmLogout(false);logout().catch(()=>undefined);}}><Text style={styles.body}>Protected screens are cleared immediately. Server revocation is requested, but may remain unconfirmed if this device is offline.</Text></AdminDialog>
        </ScrollView>
      ) : null}
      <View style={styles.tabs}>
        {teacherDestinations.map(tab => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityLabel={tab}
            accessibilityState={{ selected: destination === tab }}
            disabled={tab === 'Classes' && !canViewClasses}
            style={[styles.tab, destination === tab && styles.selected]}
            onPress={() => {
              openTab(tab);
            }}
          >
            <Text style={styles.muted}>{tab}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
