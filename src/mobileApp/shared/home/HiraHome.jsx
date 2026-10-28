import PageIcon from '../components/PageIcon';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme as t } from '../../theme/hiraTheme';
import { parentApi } from '../../roles/parent/parentService';
import { studentApi } from '../../roles/student/studentService';
import { financeApi } from '../../roles/finance/financeService';
import { parentPreview, studentPreview, financePreview } from '../data/previewData';
import {
  SchoolPanel,
  SchoolQuickActions,
  SchoolRow,
} from '../components/SchoolReferenceUI';

const copy = {
  Parent: {
    title: 'Watching them grow\nis the best part.',
    tag: 'A HAPPY PLACE TO GROW',
    description:
      'Choose your child below. Their school record stays separate at every step.',
    action: 'My children',
    page: 'My children',
  },
  Student: {
    title: 'Big ideas start\nwith curious minds.',
    tag: 'A LITTLE CURIOSITY GOES A LONG WAY',
    description: 'Your classes, your progress, your next little adventure.',
    action: 'My timetable',
    page: 'Timetable',
  },
  Finance: {
    title: 'Less paperwork.\nMore peace of mind.',
    tag: 'KEEP EVERY LITTLE DETAIL IN BALANCE',
    description:
      'Collections, vouchers and receipts — all in one calm workspace.',
    action: 'View invoices',
    page: 'Invoices',
  },
};
const money = (value, currency = 'PKR') =>
  value == null ? '—' : `${currency} ${Number(value).toLocaleString()}`;
const list = value => (Array.isArray(value) ? value : []);
function Action({ children, onPress, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        secondary && s.secondary,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[s.actionText, secondary && { color: t.primary }]}>
        {children}
      </Text>
    </Pressable>
  );
}
export default function HiraHome({
  role,
  previewOnly,
  user,
  onNavigate,
  reducedMotion,
}) {
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState('');
  const version = useRef(0);
  const float = useRef(new Animated.Value(0)).current;
  const load = useCallback(async () => {
    const current = ++version.current;
    if (previewOnly) {
      setRecords(
        role === 'Parent'
          ? parentPreview
          : role === 'Student'
          ? studentPreview
          : financePreview,
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      let data;
      if (role === 'Parent') data = { children: await parentApi.getChildren() };
      else if (role === 'Student') {
        const [profile, attendance, homework, results] = await Promise.all([
          studentApi.getProfile(),
          studentApi.getAttendance(),
          studentApi.getHomework(),
          studentApi.getResults(),
        ]);
        data = { profile, attendance, homework, results };
      } else {
        const [summary, pendingPayments] = await Promise.all([
          financeApi.getSummary(),
          financeApi.getPendingPayments(),
        ]);
        data = { summary: summary.data, pendingPayments: pendingPayments.data };
      }
      if (current === version.current) setRecords(data);
    } catch (failure) {
      if (current === version.current) {
        setRecords(null);
        setError(failure.message || 'Could not load your school records.');
      }
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [previewOnly, role]);
  useEffect(() => {
    load();
    return () => {
      version.current += 1;
    };
  }, [load]);
  useEffect(() => {
    float.setValue(0);
    if (reducedMotion || (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test')) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2500,
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2500,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [float, reducedMotion]);
  const content = copy[role];
  const profileName =
    records?.profile?.fullName || records?.profile?.name || user?.fullName || user?.name;
  const greeting =
    role === 'Parent'
      ? `Hello${
          previewOnly
            ? ', Farah'
            : profileName
            ? `, ${profileName.split(' ')[0]}`
            : ''
        }! ☀`
      : role === 'Student'
      ? `Hi${profileName ? `, ${profileName.split(' ')[0]}` : ''}! ✨`
      : 'A good day to keep things balanced.';
  const homework = list(records?.homework);
  const pending = list(records?.pendingPayments);
  const children = list(records?.children);
  const attendance = list(records?.attendance);
  const attendancePercent = attendance.length
    ? `${Math.round(
        (attendance.filter(
          item => String(item.status).toLowerCase() === 'present',
        ).length /
          attendance.length) *
          100,
      )}%`
    : '—';
  const result = list(records?.results)[0];
  if (role === 'Student') {
    const name = profileName?.split(' ')[0] || 'there';
    const studentProfile = records?.profile || {};
    const profileInitials = String(profileName || 'Student')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
    const incompleteHomework = homework.find(item => {
      const status = String(item.latestSubmission?.status || item.status || '').toLowerCase();
      return !['submitted', 'reviewed', 'graded', 'complete', 'completed'].includes(status);
    });
    const nextHomework = incompleteHomework || homework[0];
    const resultLabel = result?.grade || result?.score || '—';
    const shortcuts = [
      { label: 'Timetable', icon: 'calendar', tint: '#E8EDFF' },
      { label: 'Homework', icon: 'homework', tint: '#FFF0D8' },
      { label: 'Results', icon: 'graduation', tint: '#F1E9FF' },
      { label: 'Attendance', icon: 'calendar-check', tint: '#E5F4EB' },
    ];
    return (
      <ScrollView
        contentContainerStyle={studentStyles.page}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={t.primary} />
        }
      >
        <View style={studentStyles.topline}>
          <View style={studentStyles.greetingCopy}>
            <Text style={studentStyles.eyebrow}>YOUR LEARNING SPACE</Text>
            <Text style={studentStyles.greeting}>Hey, {name}!</Text>
            <Text style={studentStyles.subtitle}>Ready to make today count?</Text>
          </View>
          <View style={studentStyles.avatar}>
            <PageIcon name="graduation" size={26} color="#FFFFFF" />
          </View>
        </View>
        {error ? (
          <View style={s.error}>
            <Text style={s.errorText}>{error}</Text>
            <Action onPress={load}>Try again</Action>
          </View>
        ) : null}
        <View style={studentStyles.hero}>
          <View style={studentStyles.heroOrb} />
          <Text style={studentStyles.heroEyebrow}>ONE STEP AT A TIME</Text>
          <Text style={studentStyles.heroTitle}>Big goals start with{ '\n' }small wins.</Text>
          <Text style={studentStyles.heroDescription}>
            {records?.profile?.grade
              ? `${records.profile.grade}${records.profile.section ? ` · ${records.profile.section}` : ''} is yours to shine in.`
              : 'Your classes, your progress, your next adventure.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open my timetable"
            onPress={() => onNavigate('Timetable')}
            style={({ pressed }) => [studentStyles.heroButton, pressed && { opacity: 0.82 }]}
          >
            <Text style={studentStyles.heroButtonText}>View my day</Text>
            <PageIcon name="chevron" size={15} color="#34366D" />
          </Pressable>
          <PageIcon name="star" size={25} color="#FFE39A" style={studentStyles.heroStar} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open student profile"
          onPress={() => onNavigate('Profile')}
          style={({ pressed }) => [studentStyles.profileCard, pressed && { opacity: 0.88 }]}
        >
          <View style={studentStyles.profileTop}>
            <View style={studentStyles.profileAvatar}>
              <Text style={studentStyles.profileInitials}>{profileInitials}</Text>
            </View>
            <View style={studentStyles.profileCopy}>
              <Text style={studentStyles.profileEyebrow}>MY STUDENT PROFILE</Text>
              <Text numberOfLines={1} style={studentStyles.profileName}>{profileName || 'Student'}</Text>
              <Text style={studentStyles.profileMeta}>
                {studentProfile.grade
                  ? `${studentProfile.grade}${studentProfile.section ? ` · Section ${studentProfile.section}` : ''}`
                  : 'Your school profile'}
              </Text>
            </View>
            <View style={studentStyles.profileArrow}>
              <PageIcon name="chevron" size={15} color="#555CC0" />
            </View>
          </View>
          <View style={studentStyles.profileDivider} />
          <View style={studentStyles.profileDetails}>
            {[
              ['STUDENT ID', studentProfile.id],
              ['CLASS', studentProfile.classId || studentProfile.grade],
              ['SECTION', studentProfile.section],
              ['STATUS', studentProfile.status],
            ].map(([label, value]) => (
              <View key={label} style={studentStyles.profileDetail}>
                <Text style={studentStyles.detailLabel}>{label}</Text>
                <Text numberOfLines={1} style={studentStyles.detailValue}>{value || '—'}</Text>
              </View>
            ))}
          </View>
          <Text style={studentStyles.profileFooter}>View full profile</Text>
        </Pressable>
        <View style={studentStyles.stats}>
          <Pressable accessibilityRole="button" onPress={() => onNavigate('Attendance')} style={studentStyles.statCard}>
            <View style={[studentStyles.statIcon, { backgroundColor: '#E5F4EB' }]}><PageIcon name="calendar-check" size={19} /></View>
            <Text style={studentStyles.statValue}>{records ? attendancePercent : '—'}</Text>
            <Text style={studentStyles.statLabel}>Attendance</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onNavigate('Homework')} style={studentStyles.statCard}>
            <View style={[studentStyles.statIcon, { backgroundColor: '#FFF0D8' }]}><PageIcon name="homework" size={19} /></View>
            <Text style={studentStyles.statValue}>{records ? String(homework.length) : '—'}</Text>
            <Text style={studentStyles.statLabel}>Assignments</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onNavigate('Results')} style={studentStyles.statCard}>
            <View style={[studentStyles.statIcon, { backgroundColor: '#F1E9FF' }]}><PageIcon name="graduation" size={19} /></View>
            <Text style={studentStyles.statValue}>{resultLabel}</Text>
            <Text style={studentStyles.statLabel}>Latest result</Text>
          </Pressable>
        </View>
        <View style={studentStyles.sectionHeading}>
          <Text style={studentStyles.sectionTitle}>Your next step</Text>
          <Pressable accessibilityRole="button" onPress={() => onNavigate('Homework')}>
            <Text style={studentStyles.seeAll}>All homework</Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nextHomework ? `Open ${nextHomework.title || nextHomework.subject || 'homework'}` : 'Open homework'}
          onPress={() => onNavigate('Homework')}
          style={({ pressed }) => [studentStyles.homeworkCard, pressed && { opacity: 0.85 }]}
        >
          <View style={studentStyles.homeworkIcon}><PageIcon name="homework" size={23} /></View>
          <View style={studentStyles.homeworkCopy}>
            <Text style={studentStyles.homeworkEyebrow}>{nextHomework ? nextHomework.subject || 'ASSIGNMENT' : 'READY WHEN YOU ARE'}</Text>
            <Text style={studentStyles.homeworkTitle}>{nextHomework ? nextHomework.title || nextHomework.subject || 'Your assignment' : 'No assignments waiting'}</Text>
            <Text style={studentStyles.homeworkDetail}>
              {nextHomework
                ? nextHomework.dueDate ? `Due ${nextHomework.dueDate}` : 'Pick up where you left off'
                : 'Take a little time to explore your classes.'}
            </Text>
          </View>
          <PageIcon name="chevron" size={16} color={t.primary} />
        </Pressable>
        <Text style={studentStyles.sectionTitle}>Quick links</Text>
        <View style={studentStyles.shortcuts}>
          {shortcuts.map(item => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.label}`}
              onPress={() => onNavigate(item.label)}
              style={({ pressed }) => [studentStyles.shortcut, pressed && { opacity: 0.8 }]}
            >
              <View style={[studentStyles.shortcutIcon, { backgroundColor: item.tint }]}><PageIcon name={item.icon} size={21} /></View>
              <Text style={studentStyles.shortcutLabel}>{item.label}</Text>
              <PageIcon name="chevron" size={13} color="#989CB2" />
            </Pressable>
          ))}
        </View>
        {previewOnly ? <Text style={s.preview}>Design preview · sample records</Text> : null}
      </ScrollView>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={load}
          tintColor={t.primary}
        />
      }
    >
      <Text style={s.greeting}>{greeting}</Text>
      <Text style={s.subtitle}>
        {role === 'Parent'
          ? 'Your children, their progress, and all the little moments.'
          : role === 'Student'
          ? 'Ready for a little learning adventure?'
          : 'Your connected school finance workspace.'}
      </Text>
      <View style={s.hero}>
        <Animated.Image
          source={require('../../assets/school-art.webp')}
          resizeMode="cover"
          style={[
            s.art,
            {
              transform: [
                {
                  translateY: float.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -4],
                  }),
                },
                { scale: 1.04 },
              ],
            },
          ]}
        />
        <View style={s.wash} />
        {Array.from({ length: 25 }, (_, index) => (
          <View
            key={index}
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${31 + index * 2}%`,
              width: '2.1%',
              backgroundColor: '#FFE8B7',
              opacity: 1 - index / 25,
            }}
          />
        ))}
        <View style={s.heroCopy}>
          <Text style={s.tag}>{content.tag}</Text>
          <Text style={s.heroTitle}>{content.title}</Text>
          <Text style={s.heroDescription}>{content.description}</Text>
          <Action onPress={() => onNavigate(content.page)}>
            {content.action}
          </Action>
        </View>
      </View>
      {error ? (
        <View style={s.error}>
          <Text style={s.errorText}>{error}</Text>
          <Action onPress={load}>Try again</Action>
        </View>
      ) : null}
      {loading && !records ? (
        <ActivityIndicator style={{ marginVertical: 20 }} color={t.primary} />
      ) : null}
      {role === 'Parent' ? (
        <>
          <Text style={s.section}>My children</Text>
          {children.map((child, index) => (
            <Pressable
              key={child.id || child._id || index}
              onPress={() => onNavigate('Student Progress Tracking', child.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${
                child.fullName || child.name
              } child dashboard`}
              style={s.child}
            >
              <View
                style={[
                  s.portrait,
                  index % 2 === 1 && { backgroundColor: '#F3D9EA' },
                ]}
              >
                <Text style={s.star}>✦</Text>
                <Text style={s.avatar}>{index % 2 === 0 ? '👦' : '👧'}</Text>
              </View>
              <View style={s.childCopy}>
                <Text style={s.enrolled}>
                  {child.status === 'Preview'
                    ? 'Preview enrollment'
                    : child.status || 'Linked child'}
                </Text>
                <Text style={s.childName}>{child.fullName || child.name}</Text>
                <Text style={s.childMeta}>
                  {[child.grade, child.section, child.id]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <View style={s.childMetrics}>
                  <View>
                    <Text style={s.childValue}>{child.attendance || '—'}</Text>
                    <Text style={s.caption}>Attendance</Text>
                  </View>
                  <View>
                    <Text style={s.childValue}>
                      {child.latestResult || '—'}
                    </Text>
                    <Text style={s.caption}>Latest result</Text>
                  </View>
                </View>
                <Text style={s.childLink}>Open child dashboard</Text>
              </View>
            </Pressable>
          ))}
          {!loading && !error && !children.length ? (
            <Text style={s.subtitle}>No linked children available.</Text>
          ) : null}
          <SchoolPanel title="Stay connected" style={s.connected}>
            <SchoolQuickActions
              actions={[
                {
                  label: 'Request',
                  icon: '💌',
                  onPress: () => onNavigate('Applications'),
                },
                {
                  label: 'Feedback',
                  icon: '🌟',
                  onPress: () => onNavigate('Monthly Feedback'),
                },
                {
                  label: 'Calendar',
                  icon: '📅',
                  onPress: () => onNavigate('Academic Calendar'),
                },
                {
                  label: 'Inbox',
                  icon: '💬',
                  onPress: () => onNavigate('Inbox'),
                },
              ]}
            />
          </SchoolPanel>
          <SchoolPanel title="A date for your diary" style={s.connected}>
            <SchoolRow
              icon="👩‍🏫"
              title="Parent–Teacher Meetings"
              subtitle={
                previewOnly
                  ? '7 October · Book your preferred slot'
                  : 'View meeting availability with your school'
              }
              badge={previewOnly ? 'Upcoming' : undefined}
              action="Book"
              last
              onPress={() => onNavigate('PTM & Appointments')}
            />
          </SchoolPanel>
        </>
      ) : (
        <View style={s.metrics}>
          {(role === 'Finance'
            ? [
                [
                  'Collection',
                  money(
                    records?.summary?.collected,
                    records?.summary?.currency,
                  ),
                  'Collection report',
                  '#F5E9FF',
                ],
                [
                  'Outstanding',
                  money(
                    records?.summary?.outstanding,
                    records?.summary?.currency,
                  ),
                  'Outstanding dues',
                  '#FFF0D4',
                ],
                [
                  'Pending',
                  records ? String(pending.length) : '—',
                  'Pending verification',
                  '#E4F2F0',
                ],
                [
                  'Drawer balance',
                  money(
                    records?.summary?.drawerBalance,
                    records?.summary?.currency,
                  ),
                  'Payment history',
                  '#E9ECFF',
                ],
              ]
            : [
                [
                  'Attendance',
                  records ? attendancePercent : '—',
                  'Attendance',
                  '#E6F1FF',
                ],
                [
                  'Homework',
                  records ? String(homework.length) : '—',
                  'Homework',
                  '#FFF0D4',
                ],
                [
                  'Latest result',
                  result?.score == null ? '—' : String(result.score),
                  'Results',
                  '#F3E9FF',
                ],
                ['Timetable', 'View classes', 'Timetable', '#E4F2F0'],
              ]
          ).map(([label, value, route, color]) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              onPress={() => onNavigate(route)}
              style={[s.metric, { backgroundColor: color }]}
            >
              <PageIcon name={label} size={25} style={{ marginBottom: 13 }} />
              <Text style={s.metricValue}>{value}</Text>
              <Text style={s.metricLabel}>{label} ↗</Text>
            </Pressable>
          ))}
        </View>
      )}
      {previewOnly ? (
        <Text style={s.preview}>Design preview · sample records</Text>
      ) : null}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  connected: { marginTop: 14, marginBottom: 4 },
  content: { paddingHorizontal: 18, paddingBottom: 25 },
  action: {
    backgroundColor: t.primary,
    borderRadius: 16,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignSelf: 'flex-start',
    ...t.shadow,
  },
  actionText: { color: 'white', fontSize: 12, fontWeight: '700' },
  secondary: {
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
  },
  greeting: {
    color: t.ink,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
    marginTop: 20,
  },
  subtitle: { color: '#8C8B85', fontSize: 13, lineHeight: 21, marginTop: 6 },
  hero: {
    minHeight: 260,
    marginTop: 20,
    marginBottom: 20,
    borderRadius: 24,
    backgroundColor: '#FFE8B7',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EAD7AD',
    ...t.shadow,
  },
  art: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '75%',
    height: '100%',
  },
  wash: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '39%',
    backgroundColor: '#FFE8B7',
  },
  washEdge: {
    position: 'absolute',
    left: '39%',
    width: '18%',
    top: 0,
    bottom: 0,
    backgroundColor: '#FFE8B7AA',
  },
  heroCopy: { padding: 20, width: '65%', gap: 10 },
  tag: {
    color: '#8B7044',
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 1.3,
  },
  heroTitle: { color: t.ink, fontWeight: '800', fontSize: 23, lineHeight: 28 },
  heroDescription: { color: '#8B785A', fontSize: 12, lineHeight: 19 },
  section: { color: t.ink, fontSize: 19, fontWeight: '800', marginBottom: 14 },
  child: {
    flexDirection: 'row',
    minHeight: 201,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: '#EEE1D0',
    backgroundColor: t.paper,
    overflow: 'hidden',
    marginBottom: 14,
    ...t.shadow,
  },
  portrait: {
    width: '31%',
    backgroundColor: '#D4DCFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  star: {
    position: 'absolute',
    right: 18,
    top: 20,
    color: '#FFF5DB',
    fontSize: 23,
  },
  avatar: { fontSize: 61 },
  childCopy: { flex: 1, padding: 16 },
  enrolled: {
    alignSelf: 'flex-start',
    color: '#536D4F',
    backgroundColor: '#EDF3E2',
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 10,
  },
  childName: { color: t.ink, fontSize: 19, fontWeight: '700', marginTop: 9 },
  childMeta: { color: t.muted, fontSize: 11, marginTop: 4 },
  childMetrics: { flexDirection: 'row', gap: 25, marginTop: 15 },
  childValue: { fontSize: 21, fontWeight: '800', color: t.primary },
  caption: { color: t.muted, fontSize: 10, marginTop: 4 },
  childLink: {
    color: t.primary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 16,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 13,
  },
  metric: {
    width: '48%',
    minHeight: 140,
    padding: 17,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: t.border,
    ...t.shadow,
  },
  metricIcon: { color: t.primary, fontSize: 22, marginBottom: 13 },
  metricValue: { fontSize: 19, color: t.ink, fontWeight: '800' },
  metricLabel: { color: '#777683', fontSize: 12, marginTop: 8 },
  error: {
    padding: 15,
    backgroundColor: '#FFF0EE',
    borderRadius: 18,
    marginBottom: 15,
    gap: 12,
  },
  errorText: { color: '#A13B42', fontSize: 13, lineHeight: 20 },
  preview: { color: t.muted, fontSize: 10, textAlign: 'center', marginTop: 18 },
});

const studentStyles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 30, gap: 18, backgroundColor: '#F8F8FC' },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greetingCopy: { flex: 1 },
  eyebrow: { color: '#777BA0', fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  greeting: { color: '#282C5D', fontSize: 27, lineHeight: 33, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#7E8198', fontSize: 13, marginTop: 3 },
  avatar: { width: 48, height: 48, borderRadius: 17, backgroundColor: '#6268C8', alignItems: 'center', justifyContent: 'center' },
  hero: { minHeight: 218, borderRadius: 25, padding: 22, overflow: 'hidden', backgroundColor: '#343875', justifyContent: 'center' },
  heroOrb: { position: 'absolute', width: 200, height: 200, borderRadius: 100, right: -57, top: -68, backgroundColor: '#FFFFFF12', borderWidth: 1, borderColor: '#FFFFFF20' },
  heroEyebrow: { color: '#C9CDFE', fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  heroTitle: { color: '#FFFFFF', fontSize: 25, lineHeight: 31, fontWeight: '900', marginTop: 9 },
  heroDescription: { color: '#D7D9F0', fontSize: 12, lineHeight: 18, marginTop: 7, maxWidth: '82%' },
  heroButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFE6A6', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, marginTop: 15 },
  heroButtonText: { color: '#34366D', fontSize: 12, fontWeight: '800' },
  heroStar: { position: 'absolute', right: 27, bottom: 29 },
  profileCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E7F3', borderRadius: 21, padding: 15, shadowColor: '#35396C', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 2 },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileAvatar: { width: 58, height: 58, borderRadius: 19, backgroundColor: '#555CC0', borderWidth: 4, borderColor: '#ECECFF', alignItems: 'center', justifyContent: 'center' },
  profileInitials: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  profileCopy: { flex: 1, minWidth: 0 },
  profileEyebrow: { color: '#777BA0', fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
  profileName: { color: '#292D59', fontSize: 16, fontWeight: '900', marginTop: 4 },
  profileMeta: { color: '#747891', fontSize: 11, marginTop: 4 },
  profileArrow: { width: 31, height: 31, borderRadius: 11, backgroundColor: '#F0F0FF', alignItems: 'center', justifyContent: 'center' },
  profileDivider: { height: 1, backgroundColor: '#EFF0F6', marginVertical: 14 },
  profileDetails: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  profileDetail: { width: '50%', paddingRight: 8 },
  detailLabel: { color: '#9295AA', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  detailValue: { color: '#34385F', fontSize: 12, fontWeight: '800', marginTop: 4 },
  profileFooter: { color: '#555CC0', fontSize: 10, fontWeight: '800', textAlign: 'right', marginTop: 13 },
  stats: { flexDirection: 'row', gap: 9 },
  statCard: { flex: 1, minWidth: 0, minHeight: 117, padding: 12, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECECF4' },
  statIcon: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: '#30345F', fontSize: 18, fontWeight: '900', marginTop: 9 },
  statLabel: { color: '#818399', fontSize: 10, marginTop: 3 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  sectionTitle: { color: '#2B2F59', fontSize: 17, fontWeight: '900' },
  seeAll: { color: '#555CC0', fontSize: 11, fontWeight: '800' },
  homeworkCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECECF4', borderRadius: 19, padding: 14 },
  homeworkIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#FFF0D8', alignItems: 'center', justifyContent: 'center' },
  homeworkCopy: { flex: 1, minWidth: 0 },
  homeworkEyebrow: { color: '#8889A2', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  homeworkTitle: { color: '#30345F', fontSize: 14, fontWeight: '800', marginTop: 4 },
  homeworkDetail: { color: '#88899C', fontSize: 11, marginTop: 4 },
  shortcuts: { gap: 9 },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 58, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECECF4' },
  shortcutIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  shortcutLabel: { color: '#3D416A', fontSize: 12, fontWeight: '700', flex: 1 },
});
