import React from 'react';
import { useCallback, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPrincipalDashboard } from '../../api/principal';
import { useAuth } from '../../auth/AuthContext';
import {
  Button,
  Busy,
  Card,
  Empty,
  ErrorText,
  Label,
  Muted,
} from '../../components/UI';
import { colors } from '../../theme';
import { principalModules } from './modules';

const moduleDetails = {
  Classes: 'Class structure and subjects',
  Students: 'Roster and admissions',
  Teachers: 'Active faculty directory',
  Attendance: 'Daily class records',
  Notices: 'School communications',
  Timetable: 'Weekly class schedules',
  Assignments: 'Work and submissions',
  Lectures: 'Lessons and learning',
  Invoices: 'Fees and receipts',
};

export default function PrincipalHome({ navigation }) {
  const { user, schoolName, signOut, isDevMode } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (isDevMode) {
      setDashboard(null);
      setError('Preview mode has no API session. Sign in with a school account to load live data.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setDashboard(await getPrincipalDashboard());
    } catch (cause) {
      setError(
        cause.status === 401
          ? 'Your session has expired. Sign in again to continue.'
          : cause.status === 403
            ? 'You do not have access to this school dashboard.'
            : cause.status === 404
              ? 'The school dashboard is not available right now.'
              : cause.status >= 500
                ? 'The dashboard could not be loaded. Please try again.'
                : cause.message || 'Could not connect. Check your connection and retry.',
      );
                  if (cause.status === 401) await signOut();
    } finally {
      setLoading(false);
    }
  }, [isDevMode, signOut]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const summary = dashboard?.summary;
  const attendance = summary?.attendance;
  const present = attendance?.present || 0;
  const attendanceTotal = attendance
    ? attendance.present + attendance.absent + attendance.late + attendance.excused
    : 0;
  const attendanceRate = attendanceTotal
    ? Math.round((present / attendanceTotal) * 100)
    : 0;
  const branchNames = dashboard?.branches?.map(branch => branch.name).join(', ');

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <View style={styles.header}>
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>PRINCIPAL DASHBOARD</Text>
            <Text style={styles.heroTitle}>Good day, {user.name}</Text>
            <Text style={styles.heroSchool}>{schoolName}</Text>
            {!!branchNames && (
              <Text style={styles.heroBranches} numberOfLines={2}>
                {branchNames}
              </Text>
            )}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={signOut}
            style={styles.signOut}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ErrorText message={error} />
      {!!error && <Button title="Retry" onPress={load} secondary />}
      {loading && !dashboard ? <Busy /> : null}
      {summary && (
        <>
          <View style={styles.metrics}>
            <Metric label="Students" value={summary.students} accent="#167A62" />
            <Metric label="Classes" value={summary.classes} accent={colors.primary} />
            <Metric label="Teachers" value={summary.teachers} accent="#B46A12" />
          </View>

          <Card>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.cardTitle}>Attendance</Text>
                <Muted>Recorded across your branches</Muted>
              </View>
              <View style={styles.rateBlock}>
                <Text style={styles.rateValue}>{attendanceRate}%</Text>
                <Text style={styles.rateLabel}>present</Text>
              </View>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={`Attendance rate ${attendanceRate}%`}
              accessibilityValue={{ min: 0, max: 100, now: attendanceRate }}
              style={styles.attendanceTrack}
            >
              <View style={[styles.attendanceProgress, { width: `${attendanceRate}%` }]} />
            </View>
            <View style={styles.attendance}>
              {[
                ['Present', present, colors.green],
                ['Absent', attendance.absent, colors.danger],
                ['Late', attendance.late, '#A35A00'],
                ['Excused', attendance.excused, colors.muted],
              ].map(([label, value, color]) => (
                <View key={label} style={styles.attendanceItem}>
                  <Text style={[styles.attendanceValue, { color }]}>{value}</Text>
                  <Muted>{label}</Muted>
                </View>
              ))}
            </View>
          </Card>

          <SectionTitle title="Recent notices" subtitle="Latest school updates" />
          {!dashboard.recentNotices.length ? (
            <Empty text="New school notices will appear here." />
          ) : (
            dashboard.recentNotices.map(notice => (
              <Card key={notice._id}>
                <Label>{notice.title}</Label>
                <Muted numberOfLines={3}>{notice.body}</Muted>
                <Text style={styles.noticeDate}>
                  {new Date(notice.createdAt).toLocaleDateString()}
                </Text>
              </Card>
            ))
          )}
        </>
      )}

      <SectionTitle title="School operations" subtitle="Quick access to your teams and records" />
      <View style={styles.modules}>
        {principalModules.map(([title, screen]) => (
          <View key={screen} style={styles.module}>
            <Card onPress={() => navigation.navigate(screen)}>
              <View style={styles.moduleHeading}>
                <Text style={styles.moduleTitle}>{title}</Text>
                <Text style={styles.moduleArrow} accessibilityElementsHidden>
                  {'›'}
                </Text>
              </View>
              <Muted>{moduleDetails[screen]}</Muted>
            </Card>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Metric({ label, value, accent }) {
  return (
    <View style={styles.metric}>
      <View style={[styles.metricAccent, { backgroundColor: accent }]} />
      <Text style={styles.metricValue}>{value}</Text>
      <Muted>{label}</Muted>
    </View>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 36 },
  header: { marginBottom: 18 },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    padding: 20,
    backgroundColor: '#17364F',
    borderRadius: 8,
  },
  heroCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#91D7BC', fontSize: 11, fontWeight: '800', marginBottom: 9 },
  heroTitle: { color: '#FFFFFF', fontSize: 23, lineHeight: 29, fontWeight: '800', marginBottom: 9 },
  heroSchool: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', marginBottom: 3 },
  heroBranches: { color: '#C1D1DD', fontSize: 12, lineHeight: 17 },
  signOut: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#6A8194',
    borderRadius: 6,
  },
  signOutText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 2 },
  metric: {
    width: '31.5%',
    minWidth: 88,
    minHeight: 108,
    justifyContent: 'center',
    padding: 13,
    marginBottom: 14,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  metricAccent: { width: 25, height: 3, borderRadius: 2, marginBottom: 11 },
  metricValue: { color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: 3 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 5 },
  rateBlock: { alignItems: 'flex-end' },
  rateValue: { color: colors.green, fontSize: 22, fontWeight: '800' },
  rateLabel: { color: colors.muted, fontSize: 11 },
  attendanceTrack: { height: 7, overflow: 'hidden', backgroundColor: '#E7EDF1', borderRadius: 4, marginTop: 15 },
  attendanceProgress: { height: '100%', backgroundColor: colors.green, borderRadius: 4 },
  attendance: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  attendanceItem: { width: '50%', paddingVertical: 8 },
  attendanceValue: { fontSize: 20, fontWeight: '800', marginBottom: 2 },
  sectionTitle: { marginTop: 10, marginBottom: 12 },
  sectionTitleText: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 3 },
  sectionSubtitle: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  noticeDate: { color: colors.muted, fontSize: 11, marginTop: 8 },
  modules: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  module: { width: '48%' },
  moduleHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 5 },
  moduleTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  moduleArrow: { color: colors.primary, fontSize: 22, lineHeight: 22, fontWeight: '500' },
});
