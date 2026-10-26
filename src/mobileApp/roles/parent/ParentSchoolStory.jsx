import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { parentApi } from './parentService';
import { parentPreview } from '../../shared/data/previewData';
import {
  SchoolMetric,
  SchoolPanel,
  SchoolRow,
  schoolColors as c,
  schoolStyles as s,
} from '../../shared/components/SchoolReferenceUI';

const list = value => (Array.isArray(value) ? value : []);
const idOf = child => String(child?.id || child?._id || '');
const nameOf = child => child?.fullName || child?.name || 'Your child';
const identity = child =>
  [
    child?.grade &&
      `Class ${String(child.grade).replace(/^Grade\s*/i, '')}${
        child.section ? `-${child.section}` : ''
      }`,
    idOf(child) && `GR ${child.grNumber || child.studentId || idOf(child)}`,
  ]
    .filter(Boolean)
    .join(' · ');

export function resultPercent(result) {
  if (!result) return '—';
  const explicit = result.percentage ?? result.percent;
  if (explicit != null && Number.isFinite(Number(explicit)))
    return `${Number(explicit)}%`;
  const fraction = String(result.score ?? '').match(
    /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/,
  );
  const numerator = fraction
    ? Number(fraction[1])
    : Number(result.obtainedMarks ?? result.marks ?? result.score);
  const denominator = fraction
    ? Number(fraction[2])
    : Number(result.totalMarks ?? result.maxMarks);
  return Number.isFinite(numerator) && denominator > 0
    ? `${Math.round((numerator / denominator) * 100)}%`
    : '—';
}

function feeBalance(invoices) {
  if (!invoices.length) return '—';
  const currencies = new Set(invoices.map(item => item.currency || 'PKR'));
  if (currencies.size !== 1) return 'View fees';
  const total = invoices.reduce(
    (sum, item) =>
      sum +
      Number(
        item.balanceDue ??
          item.dueAmount ??
          Math.max(
            0,
            Number(item.amount || 0) -
              Number(item.confirmedPaidAmount ?? item.paidAmount ?? 0),
          ),
      ),
    0,
  );
  const currency = [...currencies][0];
  return Number.isFinite(total)
    ? `${currency === 'PKR' ? 'Rs.' : currency} ${total.toLocaleString()}`
    : '—';
}

export default function ParentSchoolStory({
  previewOnly = false,
  initialChildId = '',
  onNavigate,
  onChildChange,
}) {
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState(initialChildId);
  const [picker, setPicker] = useState(false);
  const [records, setRecords] = useState(null);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sectionErrors, setSectionErrors] = useState({});
  const version = useRef(0);
  const childrenVersion = useRef(0);
  const child = children.find(item => idOf(item) === selectedId);

  const loadChildren = useCallback(async () => {
    const request = ++childrenVersion.current;
    setLoadingChildren(true);
    setError('');
    try {
      const result = previewOnly
        ? parentPreview.children
        : list(await parentApi.getChildren());
      if (request !== childrenVersion.current) return;
      setChildren(result);
      setSelectedId(current =>
        result.some(item => idOf(item) === current)
          ? current
          : initialChildId &&
            !result.some(item => idOf(item) === initialChildId)
          ? ''
          : idOf(result[0]),
      );
    } catch (failure) {
      if (request === childrenVersion.current) {
        setChildren([]);
        setSelectedId('');
        setError(failure.message || 'Could not load linked children.');
      }
    } finally {
      if (request === childrenVersion.current) setLoadingChildren(false);
    }
  }, [previewOnly, initialChildId]);

  useEffect(() => {
    loadChildren();
    return () => {
      childrenVersion.current += 1;
    };
  }, [loadChildren]);

  const loadRecords = useCallback(async () => {
    const request = ++version.current;
    setRecords(null);
    setSectionErrors({});
    if (!selectedId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const names = [
      'profile',
      'attendance',
      'results',
      'homework',
      'fees',
      'feedback',
      'progress',
    ];
    try {
      if (previewOnly) {
        const value = parentPreview.records[selectedId];
        if (request === version.current) setRecords(value || {});
      } else {
        const results = await Promise.allSettled([
          parentApi.getChild(selectedId),
          parentApi.getAttendance(selectedId),
          parentApi.getResults(selectedId),
          parentApi.getHomework(selectedId),
          parentApi.getFees(selectedId),
          parentApi.getFeedback(selectedId),
          parentApi.getProgress(selectedId),
        ]);
        if (request !== version.current) return;
        const data = {};
        const failures = {};
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') data[names[index]] = result.value;
          else
            failures[names[index]] =
              result.reason?.message || 'Could not load this section.';
        });
        // A lost child/profile authorization hides the whole child's summary.
        if (failures.profile) {
          setRecords(null);
          setSectionErrors({ profile: failures.profile });
        } else {
          setRecords(data);
          setSectionErrors(failures);
        }
      }
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [selectedId, previewOnly]);

  useEffect(() => {
    loadRecords();
    return () => {
      version.current += 1;
    };
  }, [loadRecords]);

  function select(next) {
    version.current += 1;
    setRecords(null);
    setSectionErrors({});
    setSelectedId(idOf(next));
    if (onChildChange) onChildChange(idOf(next));
    setPicker(false);
  }
  const navigate = page => onNavigate(page, selectedId);
  const attendance = list(records?.attendance);
  const marked = attendance.filter(item =>
    ['present', 'absent', 'late', 'leave', 'excused'].includes(
      String(item.status).toLowerCase(),
    ),
  );
  const attended = marked.filter(item =>
    ['present', 'late'].includes(String(item.status).toLowerCase()),
  );
  const attendanceValue =
    previewOnly && child?.attendance
      ? child.attendance
      : marked.length
      ? `${Math.round((attended.length / marked.length) * 100)}%`
      : '—';
  const results = list(records?.results);
  const homework = list(records?.homework);
  const pending = homework.filter(
    item =>
      !['submitted', 'reviewed', 'completed', 'approved'].includes(
        String(
          item.latestSubmission?.status || item.submissionStatus || '',
        ).toLowerCase(),
      ),
  );
  const feedback = records?.feedback;
  const progress = list(records?.progress || feedback?.progress);
  const publishedFeedback = [
    ...progress,
    ...list(feedback?.results),
    ...list(feedback?.homework),
  ];
  // Behaviour is never inferred from grades or academic feedback.
  const behaviour = progress.filter(item =>
    /behavio[u]?r|personal|wellbeing/.test(
      String(item.category || item.type || item.area || '').toLowerCase(),
    ),
  );

  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl
          refreshing={loading || loadingChildren}
          onRefresh={() => {
            loadChildren();
            loadRecords();
          }}
          tintColor={c.primary}
        />
      }
    >
      <View>
        <Text style={s.title}>
          {child
            ? `${nameOf(child)}’s school story`
            : 'Your child’s school story'}
        </Text>
        <Text style={s.subtitle}>
          Attendance, academics, work and wellbeing—one student at a time.
        </Text>
      </View>
      {loadingChildren ? (
        <ActivityIndicator
          color={c.primary}
          accessibilityLabel="Loading linked children"
        />
      ) : null}
      {error ? (
        <SchoolPanel title="Could not load linked children">
          <Text accessibilityRole="alert" style={s.subtitle}>
            {error}
          </Text>
          <Pressable onPress={loadChildren} accessibilityRole="button">
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </SchoolPanel>
      ) : null}
      {child ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch child"
          onPress={() => setPicker(true)}
          style={styles.selector}
        >
          <Text style={styles.childIcon}>👦</Text>
          <Text style={styles.childName}>{nameOf(child)}⌄</Text>
          <Text style={styles.childMeta}>{identity(child)}</Text>
          <Text style={styles.switch}>Switch</Text>
        </Pressable>
      ) : !loadingChildren && !error ? (
        <SchoolPanel>
          <Text style={s.subtitle}>
            {initialChildId
              ? 'This child is no longer available to your account.'
              : 'No verified linked children available.'}
          </Text>
        </SchoolPanel>
      ) : null}
      {child ? (
        <>
          {loading ? (
            <ActivityIndicator
              color={c.primary}
              accessibilityLabel="Loading child summary"
            />
          ) : null}
          <View style={s.stats}>
            <SchoolMetric
              label="Attendance"
              value={records ? attendanceValue : '—'}
              note="Marked school days"
              icon="✅"
              onPress={() => navigate('Attendance')}
            />
            <SchoolMetric
              label="Latest result"
              value={resultPercent(results[0])}
              note={results[0]?.examName || 'Published results'}
              icon="🏆"
              color="#E5F2DE"
              onPress={() => navigate('Academic Report')}
            />
            <SchoolMetric
              label="Homework"
              value={
                !records || !records.homework
                  ? '—'
                  : pending.length
                  ? 'Pending'
                  : homework.length
                  ? 'Complete'
                  : '—'
              }
              note="Current assignment"
              icon="✏️"
              color="#FFF1BF"
              onPress={() => navigate('Homework')}
            />
            <SchoolMetric
              label="Fee balance"
              value={feeBalance(list(records?.fees))}
              note={
                list(records?.fees).length === 1
                  ? records.fees[0].description || 'Current voucher'
                  : 'Current vouchers'
              }
              icon="💳"
              color="#F8E1EB"
              onPress={() => navigate('Fees')}
            />
          </View>
          {Object.keys(sectionErrors).length ? (
            <SchoolPanel title="Some records could not be loaded">
              <Text accessibilityRole="alert" style={s.subtitle}>
                {Object.values(sectionErrors).join('\n')}
              </Text>
              <Pressable onPress={loadRecords} accessibilityRole="button">
                <Text style={styles.retry}>Retry these records</Text>
              </Pressable>
            </SchoolPanel>
          ) : null}
          <SchoolPanel title="Learning & school life">
            <SchoolRow
              icon="📚"
              title="Academic progress"
              subtitle="Subject results and term comparison"
              badge={results.length ? 'Published' : undefined}
              onPress={() => navigate('Academic Report')}
            />
            <SchoolRow
              icon="🌱"
              title="Personal & behaviour"
              subtitle="Reviewed teacher observations"
              badge={behaviour.length ? 'Published' : undefined}
              onPress={() => navigate('Personal & Behaviour Report')}
            />
            <SchoolRow
              icon="🌟"
              title="Monthly feedback"
              subtitle={publishedFeedback[0]?.period || 'Teacher comments'}
              badge={publishedFeedback.length ? 'Published' : undefined}
              last
              onPress={() => navigate('Monthly Feedback')}
            />
          </SchoolPanel>
          <SchoolPanel title="Your next little steps">
            <SchoolRow
              icon="✏️"
              title={homework[0]?.subject || 'Homework'}
              subtitle={homework[0]?.title || 'Current assignments'}
              action="Open"
              onPress={() => navigate('Homework')}
            />
            <SchoolRow
              icon="💬"
              title="School messages"
              subtitle="Your conversations with the school"
              action="Open"
              last
              onPress={() => navigate('Inbox')}
            />
          </SchoolPanel>
          <SchoolPanel title="Student record">
            <View style={styles.profile}>
              <Text style={styles.avatar}>👦</Text>
              <View style={styles.flex}>
                <Text style={styles.profileName}>{nameOf(child)}</Text>
                <Text style={s.subtitle}>
                  {identity(records?.profile || child)}
                </Text>
              </View>
            </View>
            <Text style={s.subtitle}>
              Only your verified linked children are available.
            </Text>
          </SchoolPanel>
        </>
      ) : null}
      {previewOnly ? (
        <Text style={s.preview}>
          Development design preview · fictional local records
        </Text>
      ) : null}
      <Modal
        visible={picker}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            accessibilityRole="button"
            accessibilityLabel="Close child selector"
            onPress={() => setPicker(false)}
          />
          <View style={styles.sheet}>
            <Text style={styles.profileName}>Choose your child</Text>
            <ScrollView>
              {children.map(item => (
                <SchoolRow
                  key={idOf(item)}
                  icon="👦"
                  title={nameOf(item)}
                  subtitle={identity(item)}
                  badge={idOf(item) === selectedId ? 'Selected' : undefined}
                  action="Open"
                  onPress={() => select(item)}
                />
              ))}
            </ScrollView>
            <Pressable
              onPress={() => setPicker(false)}
              accessibilityRole="button"
            >
              <Text style={styles.retry}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#EDF4E3',
    flexWrap: 'wrap',
  },
  childIcon: { fontSize: 17 },
  childName: { color: c.ink, fontSize: 12, fontWeight: '700' },
  childMeta: { color: c.muted, fontSize: 10, flexShrink: 1 },
  switch: {
    color: c.primary,
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  retry: { color: c.primary, fontWeight: '700', paddingVertical: 14 },
  flex: { flex: 1 },
  profile: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  avatar: { fontSize: 38 },
  profileName: { color: c.ink, fontSize: 19, fontWeight: '800' },
  overlay: {
    flex: 1,
    backgroundColor: '#252B5260',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    paddingBottom: 34,
    maxHeight: '70%',
  },
});
