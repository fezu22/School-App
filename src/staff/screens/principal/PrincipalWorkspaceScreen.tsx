import React, { useMemo, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import type { ApprovalRequest } from '../../services/principal/principalService';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import { colors, fonts, typography } from '../../theme/hiraDashboard';
import PrincipalApprovalsScreen from './PrincipalApprovalsScreen';
import PrincipalDashboardScreen from './PrincipalDashboardScreen';
import PrincipalInboxScreen from './PrincipalInboxScreen';
import {hasPermission, PERMISSIONS} from '../../constants/permissions';

type TabKey = 'home' | 'approvals' | 'inbox';
type Navigation = NativeStackNavigationProp<PrincipalStackParamList>;

const tabs: { key: TabKey; title: string; icon: string; group: string }[] = [
  { key: 'home', title: 'Home', icon: '▦', group: 'SCHOOL OPERATIONS' },
  {
    key: 'approvals',
    title: 'Approvals',
    icon: '✓',
    group: 'MESSAGES & REQUESTS',
  },
  { key: 'inbox', title: 'Inbox', icon: '✉', group: 'MESSAGES & REQUESTS' },
];

const tabHeading: Record<TabKey, string> = {
  home: 'Overview',
  approvals: 'Approvals',
  inbox: 'Messages',
};

const greeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const roleName = (role?: string): string => {
  if (!role) return 'Principal';
  return role
    .split('_')
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
};

export default function PrincipalWorkspaceScreen() {
  const navigation = useNavigation<Navigation>();
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const openTab = (tab: TabKey) => {
    setActiveTab(tab);
    setDrawerOpen(false);
    setQuery('');
  };

  const openApproval = (request: ApprovalRequest) => {
    setDrawerOpen(false);
    if (request.entityType === 'academic_result') navigation.navigate('ResultModeration',{approvalId:request._id});
    else if (['attendance_correction','student_leave'].includes(request.entityType)) navigation.navigate('AttendanceReview',{approvalId:request._id});
    else navigation.navigate('ApprovalDetail', { request });
  };

  const openNotice = (noticeId: string) => {
    setDrawerOpen(false);
    navigation.navigate('NoticeDetail', { noticeId });
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const showTimetable = 'manage timetable scheduling academic management'.includes(normalizedQuery) && hasPermission(user?.role, PERMISSIONS.TIMETABLE_MANAGE);
  const showRooms = 'rooms physical classroom lab'.includes(normalizedQuery) && hasPermission(user?.role, PERMISSIONS.ACADEMIC_ROOMS_VIEW);
  const showAcademicSetup = 'academic setup'.includes(normalizedQuery) && hasPermission(user?.role, PERMISSIONS.ACADEMIC_CLASSES_VIEW);
  const visibleTabs = tabs.filter(item =>
    `${item.title} ${item.group}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const currentTitle = tabHeading[activeTab];
  const edgeSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.x0 <= 20 &&
          gesture.dx >= 24 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx >= 72) setDrawerOpen(true);
        },
      }),
    [],
  );

  return (
    <View {...edgeSwipe.panHandlers} style={styles.shell}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.topSafeArea}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open navigation drawer"
            onPress={() => setDrawerOpen(true)}
            style={({ pressed }) => [
              styles.menuButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.menuGlyph}>⋮</Text>
          </Pressable>
          <View style={styles.brand}>
            <Text style={styles.brandLetter}>H</Text>
          </View>
          <View style={styles.topCopy}>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.topTitle}>{currentTitle}</Text>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.page}>
        {activeTab === 'home' ? (
          <PrincipalDashboardScreen
            onOpenApprovals={() => openTab('approvals')}
            onOpenInbox={() => openTab('inbox')}
            onOpenTasks={() => navigation.navigate('Tasks')}
            onOpenSafety={() => navigation.navigate('SafetyOverview')}
            onAssignTeacher={() => navigation.navigate('AssignTeacher')}
          />
        ) : activeTab === 'approvals' ? (
          <PrincipalApprovalsScreen onReview={openApproval} onOpenResults={() => navigation.navigate('Results')} />
        ) : (
          <PrincipalInboxScreen onOpenNotice={openNotice} />
        )}
      </View>

      <SafeAreaView
        edges={['bottom', 'left', 'right']}
        style={styles.bottomSafeArea}
      >
        <View style={styles.bottomBar}>
          {tabs.map(tab => {
            const selected = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => openTab(tab.key)}
                style={styles.tabButton}
              >
                <View
                  style={[styles.tabPill, selected && styles.tabPillActive]}
                >
                  <Text
                    style={[styles.tabIcon, selected && styles.tabTextActive]}
                  >
                    {tab.icon}
                  </Text>
                  <Text
                    style={[styles.tabLabel, selected && styles.tabTextActive]}
                  >
                    {tab.title}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>

      <Modal
        visible={drawerOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View style={styles.drawerLayer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation drawer"
            onPress={() => setDrawerOpen(false)}
            style={styles.backdrop}
          />
          <SafeAreaView edges={['top', 'bottom']} style={styles.drawer}>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerHeadingCopy}>
                <Text style={styles.drawerEyebrow}>YOUR SCHOOL WORKSPACE</Text>
                <Text style={styles.drawerTitle}>Navigation</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close navigation drawer"
                onPress={() => setDrawerOpen(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeGlyph}>×</Text>
              </Pressable>
            </View>

            <View style={styles.roleBox}>
              <View style={styles.roleIcon}>
                <Text style={styles.roleGlyph}>⌂</Text>
              </View>
              <View style={styles.roleCopy}>
                <Text style={styles.roleCaption}>CURRENT ROLE</Text>
                <Text style={styles.roleTitle}>{roleName(user?.role)}</Text>
              </View>
            </View>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search pages, reports, DLP..."
              placeholderTextColor={colors.muted}
              accessibilityLabel="Search pages"
              style={styles.search}
              returnKeyType="search"
            />

            <ScrollView
              style={styles.drawerList}
              keyboardShouldPersistTaps="handled"
            >
              {visibleTabs.length === 0 && !('students enrollment'.includes(normalizedQuery) && hasPermission(user?.role, PERMISSIONS.ENROLLMENT_VIEW)) && !showAcademicSetup && !showTimetable && !showRooms ? (
                <Text style={styles.noMatches}>
                  No pages match your search.
                </Text>
              ) : (
                [...new Set(visibleTabs.map(item => item.group))].map(group => (
                  <View key={group}>
                    <Text style={styles.groupTitle}>{group}</Text>
                    {visibleTabs
                      .filter(item => item.group === group)
                      .map(item => {
                        const selected = activeTab === item.key;
                        return (
                          <Pressable
                            key={item.key}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            onPress={() => openTab(item.key)}
                            style={[
                              styles.drawerRow,
                              selected && styles.drawerRowActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.drawerIcon,
                                selected && styles.drawerIconActive,
                              ]}
                            >
                              {item.icon}
                            </Text>
                            <Text
                              style={[
                                styles.drawerLabel,
                                selected && styles.drawerLabelActive,
                              ]}
                            >
                              {item.title}
                            </Text>
                          </Pressable>
                        );
                      })}
                  </View>
                ))
              )}
              {'students enrollment'.includes(normalizedQuery) && hasPermission(user?.role, PERMISSIONS.ENROLLMENT_VIEW) ? <View><Text style={styles.groupTitle}>STUDENT ADMINISTRATION</Text><Pressable accessibilityRole="button" accessibilityLabel="Students & Enrollment" style={styles.drawerRow} onPress={() => {setDrawerOpen(false); setQuery(''); navigation.navigate('StudentsEnrollment');}}><Text style={styles.drawerIcon}>▤</Text><Text style={styles.drawerLabel}>Students & Enrollment</Text></Pressable></View> : null}
              {showAcademicSetup || showTimetable || showRooms ? <View><Text style={styles.groupTitle}>ACADEMIC ADMINISTRATION</Text>{showRooms ? <Pressable accessibilityRole="button" accessibilityLabel="Rooms" style={styles.drawerRow} onPress={() => {setDrawerOpen(false); setQuery(''); navigation.navigate('Rooms');}}><Text style={styles.drawerIcon}>▤</Text><Text style={styles.drawerLabel}>Rooms</Text></Pressable> : null}{showAcademicSetup ? <Pressable accessibilityRole="button" accessibilityLabel="Academic Setup" style={styles.drawerRow} onPress={() => {setDrawerOpen(false); setQuery(''); navigation.navigate('AcademicSetup');}}><Text style={styles.drawerIcon}>▤</Text><Text style={styles.drawerLabel}>Academic Setup</Text></Pressable> : null}{showTimetable ? <Pressable accessibilityRole="button" accessibilityLabel="Manage Timetable" style={styles.drawerRow} onPress={() => {setDrawerOpen(false); setQuery(''); navigation.navigate('TimetableAdmin');}}><Text style={styles.drawerIcon}>▦</Text><Text style={styles.drawerLabel}>Manage Timetable</Text></Pressable> : null}</View> : null}
            </ScrollView>

            <View style={styles.drawerFooter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Log out of Principal dashboard"
                onPress={() => {
                  setDrawerOpen(false);
                  logout();
                }}
                style={({ pressed }) => [
                  styles.logoutButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.logoutGlyph}>↪</Text>
                <Text style={styles.logoutLabel}>Log out</Text>
              </Pressable>
              <Text style={styles.footerText}>
                {tabs.length} role screens · All pages live here
              </Text>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  topSafeArea: { backgroundColor: colors.background },
  topBar: {
    minHeight: 62,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.softBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuGlyph: {
    fontSize: 25,
    lineHeight: 28,
    color: colors.primary,
    marginTop: -7,
  },
  brand: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLetter: {
    fontFamily: fonts.headingBlack,
    fontSize: 23,
    color: '#ffdc75',
  },
  topCopy: { flex: 1, gap: 1 },
  greeting: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 10,
    letterSpacing: 1.1,
    color: colors.muted,
  },
  topTitle: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 17,
    color: colors.ink,
  },
  page: { flex: 1 },
  bottomSafeArea: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: '#ede4d9',
  },
  bottomBar: {
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    backgroundColor: colors.card,
  },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabPill: {
    minWidth: 76,
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabPillActive: { backgroundColor: colors.soft },
  tabIcon: { fontSize: 17, lineHeight: 21, color: colors.muted },
  tabLabel: { ...typography.caption, color: colors.muted },
  tabTextActive: { color: colors.primary },
  drawerLayer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'transparent',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(29, 38, 62, 0.34)',
  },
  drawer: {
    width: '88%',
    maxWidth: 360,
    backgroundColor: colors.background,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  drawerHeadingCopy: { gap: 4 },
  drawerEyebrow: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 1.25,
  },
  drawerTitle: { ...typography.h1, color: colors.ink },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    fontSize: 27,
    lineHeight: 30,
    color: colors.ink,
    marginTop: -3,
  },
  roleBox: {
    minHeight: 66,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.soft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  roleIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleGlyph: { fontSize: 20, color: colors.primary },
  roleCopy: { gap: 3 },
  roleCaption: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 9,
    letterSpacing: 1,
  },
  roleTitle: {
    ...typography.bodyStrong,
    color: colors.ink,
    textTransform: 'capitalize',
  },
  search: {
    height: 46,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    paddingHorizontal: 13,
    color: colors.ink,
    ...typography.small,
    marginBottom: 12,
  },
  drawerList: { flex: 1 },
  groupTitle: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 13,
    marginBottom: 6,
  },
  drawerRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 11,
    borderRadius: 10,
    marginBottom: 3,
  },
  drawerRowActive: { backgroundColor: colors.soft },
  drawerIcon: {
    width: 22,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 17,
  },
  drawerIconActive: { color: colors.primary },
  drawerLabel: { ...typography.body, color: colors.ink },
  drawerLabelActive: {
    fontFamily: typography.bodyStrong.fontFamily,
    color: colors.primary,
  },
  noMatches: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 28,
  },
  drawerFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 10,
  },
  logoutButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.absent.border,
    backgroundColor: colors.absent.bg,
  },
  logoutGlyph: {
    color: colors.absent.text,
    fontSize: 19,
    fontWeight: '700',
  },
  logoutLabel: {
    ...typography.bodyStrong,
    color: colors.absent.text,
  },
  footerText: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
  },
  pressed: { opacity: 0.75 },
});
