import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { parentApi } from './parentService';
import { studentApi } from '../student/studentService';
import { parentPreview, studentPreview } from '../../shared/data/previewData';
import { resultPercent } from './ParentSchoolStory';
import {
  SchoolBadge,
  SchoolMetric,
  SchoolPanel,
  SchoolRow,
  schoolColors as c,
  schoolStyles as s,
} from '../../shared/components/SchoolReferenceUI';

const array = value => (Array.isArray(value) ? value : []);
const childId = child => String(child?.id || child?._id || '');
const childName = child => child?.fullName || child?.name || 'Your child';
const childClass = child =>
  [String(child?.grade || '').replace(/^Grade\s*/i, ''), child?.section]
    .filter(Boolean)
    .join('-');
const childInfo = child =>
  [
    childClass(child) && `Class ${childClass(child)}`,
    childId(child) &&
      `GR #${child.grNumber || child.studentId || childId(child)}`,
  ]
    .filter(Boolean)
    .join(' · ');
export function attendanceSummary(records) {
  const marked = array(records).filter(item =>
    ['present', 'absent', 'late', 'leave', 'excused'].includes(
      String(item.status).toLowerCase(),
    ),
  );
  const present = marked.filter(
    item => String(item.status).toLowerCase() === 'present',
  ).length;
  const attended = marked.filter(item =>
    ['present', 'late'].includes(String(item.status).toLowerCase()),
  ).length;
  return {
    present,
    total: marked.length,
    percent: marked.length
      ? `${Math.round((attended / marked.length) * 100)}%`
      : '—',
  };
}
export function calendarDays(year, month) {
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [
    ...Array(offset).fill(null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
}

function useLinkedRecords({
  role,
  previewOnly,
  initialChildId,
  section,
  onChildChange,
}) {
  const [children, setChildren] = useState([]),
    [selectedId, setSelectedId] = useState(initialChildId || '');
  const [records, setRecords] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const version = useRef(0),
    listVersion = useRef(0);
  const loadChildren = useCallback(async () => {
    const request = ++listVersion.current;
    setLoading(true);
    setError('');
    setRecords(null);
    try {
      const data =
        role === 'Student'
          ? [
              previewOnly
                ? studentPreview.profile
                : await studentApi.getProfile(),
            ]
          : previewOnly
          ? parentPreview.children
          : array(await parentApi.getChildren());
      if (request !== listVersion.current) return;
      setChildren(data);
      setSelectedId(current =>
        data.some(item => childId(item) === current)
          ? current
          : initialChildId
          ? ''
          : childId(data[0]),
      );
    } catch (failure) {
      if (request === listVersion.current) {
        setChildren([]);
        setSelectedId('');
        setError(failure.message || 'Could not load student records.');
      }
    } finally {
      if (request === listVersion.current) setLoading(false);
    }
  }, [role, previewOnly, initialChildId]);
  useEffect(() => {
    loadChildren();
    return () => {
      listVersion.current += 1;
    };
  }, [loadChildren]);
  const selected = children.find(item => childId(item) === selectedId);
  const loadRecords = useCallback(async () => {
    const request = ++version.current;
    setRecords(null);
    if (!selectedId || section === 'children') return;
    setLoading(true);
    setError('');
    try {
      const value = previewOnly
        ? role === 'Student'
          ? studentPreview[section]
          : parentPreview.records[selectedId]?.[section]
        : role === 'Student'
        ? await studentApi[
            section === 'attendance' ? 'getAttendance' : 'getTimetable'
          ]()
        : await parentApi[
            section === 'attendance' ? 'getAttendance' : 'getTimetable'
          ](selectedId);
      if (request === version.current) setRecords(array(value));
    } catch (failure) {
      if (request === version.current)
        setError(failure.message || 'Could not load this child’s records.');
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [selectedId, section, previewOnly, role]);
  useEffect(() => {
    loadRecords();
    return () => {
      version.current += 1;
    };
  }, [loadRecords]);
  // A revoked link must immediately discard the prior child's data.
  const select = child => {
    version.current += 1;
    setRecords(null);
    setError('');
    setSelectedId(childId(child));
    onChildChange?.(childId(child));
  };
  return {
    children,
    selected,
    records,
    loading,
    error,
    select,
    refresh: () => {
      version.current += 1;
      loadChildren();
      loadRecords();
    },
    retry: selected ? loadRecords : loadChildren,
  };
}

function ChildPicker({ model }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Pressable
        style={styles.selector}
        accessibilityRole="button"
        accessibilityLabel="Switch child"
        onPress={() => setVisible(true)}
      >
        <Text style={styles.smallAvatar}>👦</Text>
        <View style={styles.flex}>
          <Text style={styles.selectorName}>{childName(model.selected)} ⌄</Text>
          <Text style={styles.selectorMeta}>{childInfo(model.selected)}</Text>
        </View>
        <Text style={styles.link}>Switch</Text>
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            accessibilityRole="button"
            accessibilityLabel="Close child picker"
            onPress={() => setVisible(false)}
          />
          <View style={styles.sheet}>
            <Text style={s.title}>Choose your child</Text>
            <ScrollView>
              {model.children.map(child => (
                <SchoolRow
                  key={childId(child)}
                  title={childName(child)}
                  subtitle={childInfo(child)}
                  icon="👦"
                  onPress={() => {
                    model.select(child);
                    setVisible(false);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
function State({ model }) {
  return (
    <>
      {model.loading ? <ActivityIndicator color={c.primary} /> : null}
      {model.error ? (
        <SchoolPanel title="Could not load records">
          <Text accessibilityRole="alert" style={s.subtitle}>
            {model.error}
          </Text>
          <Pressable accessibilityRole="button" onPress={model.retry}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </SchoolPanel>
      ) : null}
      {!model.loading && !model.error && !model.children.length ? (
        <SchoolPanel>
          <Text style={s.subtitle}>No verified linked children available.</Text>
        </SchoolPanel>
      ) : null}
      {!model.loading &&
      !model.error &&
      model.children.length > 0 &&
      !model.selected ? (
        <SchoolPanel>
          <Text style={s.subtitle}>
            This student is no longer available to your account.
          </Text>
        </SchoolPanel>
      ) : null}
    </>
  );
}
function ChildCard({ child, previewOnly, onNavigate, selected }) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    let alive = true;
    if (previewOnly) {
      setSummary({
        attendance: child.attendance || '—',
        result: child.latestResult || '—',
      });
      return undefined;
    }
    Promise.allSettled([
      parentApi.getAttendance(childId(child)),
      parentApi.getResults(childId(child)),
    ]).then(values => {
      if (alive)
        setSummary({
          attendance:
            values[0].status === 'fulfilled'
              ? attendanceSummary(values[0].value).percent
              : '—',
          result:
            values[1].status === 'fulfilled'
              ? resultPercent(array(values[1].value)[0])
              : '—',
        });
    });
    return () => {
      alive = false;
    };
  }, [child, previewOnly]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${childName(child)} school story`}
      onPress={() => onNavigate('Student Progress Tracking', childId(child))}
      style={[styles.childCard, selected && styles.selectedCard]}
    >
      <View
        style={[
          styles.portrait,
          selected ? styles.boyPortrait : styles.girlPortrait,
        ]}
      >
        <Text style={styles.sparkle}>✦</Text>
        <Text style={styles.childAvatar}>
          {previewOnly ? (selected ? '👦' : '👧') : '🧒'}
        </Text>
      </View>
      <View style={styles.childCopy}>
        <View style={styles.badgeWrap}>
          {previewOnly ||
          child.status === 'active' ||
          child.enrollmentStatus === 'active' ? (
            <SchoolBadge>Active enrollment</SchoolBadge>
          ) : (
            <Text style={styles.selectorMeta}>Linked student</Text>
          )}
        </View>
        <Text style={styles.childName}>{childName(child)}</Text>
        <Text style={styles.childInfo}>{childInfo(child)}</Text>
        <View style={styles.childMetrics}>
          {[
            ['Attendance', summary?.attendance],
            ['Latest result', summary?.result],
          ].map(([label, value]) => (
            <View key={label}>
              <Text style={styles.metricValue}>{value || '—'}</Text>
              <Text style={styles.metricLabel}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.link}>Open child dashboard</Text>
      </View>
    </Pressable>
  );
}

export default function ParentReferencePages({
  page,
  role = 'Parent',
  previewOnly = false,
  initialChildId = '',
  onNavigate,
  onChildChange,
}) {
  const section =
    page === 'My children'
      ? 'children'
      : ['Attendance', 'Attendance Calendar'].includes(page)
      ? 'attendance'
      : 'timetable';
  const model = useLinkedRecords({
    role,
    previewOnly,
    initialChildId,
    section,
    onChildChange,
  });
  const now = new Date();
  const [month, setMonth] = useState(() =>
    previewOnly
      ? new Date(2026, 8, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [day, setDay] = useState('All'),
    [lesson, setLesson] = useState(null),
    [selectedDate, setSelectedDate] = useState('');
  useEffect(() => {
    setLesson(null);
    setSelectedDate('');
  }, [model.selected?.id]);
  const monthName = month.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const prefix = `${month.getFullYear()}-${String(
    month.getMonth() + 1,
  ).padStart(2, '0')}`;
  const attendance = array(model.records).filter(item =>
    String(item.date || item.attendanceDate || '').startsWith(prefix),
  );
  const summary = attendanceSummary(attendance);
  const timetable = array(model.records).filter(
    item =>
      day === 'All' ||
      String(item.day || item.weekday || '').toLowerCase() ===
        day.toLowerCase(),
  );
  const moveMonth = delta => {
    setMonth(
      current => new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
    setSelectedDate('');
  };
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl
          refreshing={model.loading}
          onRefresh={model.refresh}
          tintColor={c.primary}
        />
      }
    >
      <View>
        <Text style={s.title}>
          {section === 'children'
            ? model.children.length === 2
              ? 'Two little worlds. One happy home.'
              : 'Their school story, all in one place.'
            : section === 'attendance'
            ? 'Attendance'
            : 'Today has a little of everything.'}
        </Text>
        <Text style={s.subtitle}>
          {section === 'children'
            ? 'Choose a child to see their own school record.'
            : section === 'attendance'
            ? 'Every school day, clearly recorded.'
            : `${
                model.selected ? childInfo(model.selected) + ' · ' : ''
              }Your published timetable`}
        </Text>
      </View>
      <State model={model} />
      {section === 'children' ? (
        <>
          <View style={styles.hero}>
            <Image
              source={require('../../assets/school-art.webp')}
              style={styles.heroArt}
              resizeMode="cover"
              accessible={false}
            />
            <View style={styles.heroCopy}>
              <Text style={styles.overline}>A HAPPY PLACE TO GROW</Text>
              <Text style={styles.heroTitle}>
                Their school story,{'\n'}all in one place.
              </Text>
              <Text style={styles.heroText}>
                Every child has their own dashboard, reports, work and feedback.
              </Text>
              <Pressable
                disabled={!model.children.length}
                accessibilityRole="button"
                onPress={() =>
                  model.children.length &&
                  onNavigate(
                    'Student Progress Tracking',
                    childId(model.selected || model.children[0]),
                  )
                }
                style={styles.heroButton}
              >
                <Text style={styles.heroButtonText}>View selected child</Text>
              </Pressable>
            </View>
          </View>
          {model.children.map((child, index) => (
            <ChildCard
              key={childId(child)}
              child={child}
              selected={index === 0}
              previewOnly={previewOnly}
              onNavigate={onNavigate}
            />
          ))}
        </>
      ) : model.selected && !model.error ? (
        <>
          {role === 'Parent' ? <ChildPicker model={model} /> : null}
          {section === 'attendance' ? (
            <>
              <View style={s.stats}>
                <SchoolMetric
                  label="Attendance"
                  value={model.records ? summary.percent : '—'}
                  note={monthName}
                  icon="✅"
                />
                <SchoolMetric
                  label="Present days"
                  value={model.records ? String(summary.present) : '—'}
                  note={`Out of ${summary.total} marked days`}
                  icon="📅"
                  color="#E5F2DE"
                />
              </View>
              <SchoolPanel>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>{monthName}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      onNavigate('Applications', childId(model.selected))
                    }
                  >
                    <Text style={styles.link}>Request leave</Text>
                  </Pressable>
                </View>
                <View style={styles.monthControls}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Previous month"
                    onPress={() => moveMonth(-1)}
                  >
                    <Text style={styles.monthButton}>‹</Text>
                  </Pressable>
                  <Text style={styles.selectorMeta}>Read-only attendance</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Next month"
                    onPress={() => moveMonth(1)}
                  >
                    <Text style={styles.monthButton}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.calendar}>
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => (
                    <View style={styles.dayCell} key={'weekday' + index}>
                      <Text style={styles.weekday}>{label}</Text>
                    </View>
                  ))}
                  {calendarDays(month.getFullYear(), month.getMonth()).map(
                    (value, index) => {
                      const date = `${prefix}-${String(value).padStart(
                        2,
                        '0',
                      )}`;
                      const rows = attendance.filter(
                        item =>
                          String(item.date || item.attendanceDate || '').slice(
                            0,
                            10,
                          ) === date,
                      );
                      const statuses = [
                        ...new Set(
                          rows.map(item =>
                            String(item.status || '').toLowerCase(),
                          ),
                        ),
                      ];
                      const status =
                        statuses.length === 1
                          ? statuses[0]
                          : statuses.length
                          ? 'mixed'
                          : 'unmarked';
                      return (
                        <Pressable
                          key={index}
                          disabled={
                            !value || model.loading || model.records == null
                          }
                          accessibilityRole="button"
                          accessibilityLabel={
                            value ? `${date}: ${status}` : undefined
                          }
                          onPress={() => setSelectedDate(date)}
                          style={[
                            styles.dayCell,
                            value && styles.dayBox,
                            value && styles[status],
                            selectedDate === date && styles.selectedDay,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayNumber,
                              selectedDate === date && styles.selectedDayText,
                            ]}
                          >
                            {value || ''}
                          </Text>
                        </Pressable>
                      );
                    },
                  )}
                </View>
                {selectedDate ? (
                  <Text style={s.subtitle}>
                    {selectedDate}:{' '}
                    {attendance
                      .filter(
                        item =>
                          String(item.date || item.attendanceDate || '').slice(
                            0,
                            10,
                          ) === selectedDate,
                      )
                      .map(item =>
                        [item.subject, item.status].filter(Boolean).join(' · '),
                      )
                      .join('; ') || 'No attendance record'}
                  </Text>
                ) : null}
                <View style={styles.legend}>
                  {['Present', 'Absent', 'Late', 'Leave'].map(label => (
                    <View
                      style={[styles.legendBadge, styles[label.toLowerCase()]]}
                      key={label}
                    >
                      <Text style={styles.legendText}>{label}</Text>
                    </View>
                  ))}
                  <Text style={styles.selectorMeta}>Grey: no record</Text>
                </View>
              </SchoolPanel>
            </>
          ) : (
            <>
              <View style={styles.dayFilters}>
                {[
                  'All',
                  'Monday',
                  'Tuesday',
                  'Wednesday',
                  'Thursday',
                  'Friday',
                  'Saturday',
                  'Sunday',
                ].map(value => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: day === value }}
                    onPress={() => setDay(value)}
                    style={[
                      styles.dayFilter,
                      day === value && styles.dayFilterActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayFilterText,
                        day === value && styles.selectedDayText,
                      ]}
                    >
                      {value === 'All' ? 'All days' : value.slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <SchoolPanel title="Your school day">
                {!model.loading && !model.error && !timetable.length ? (
                  <Text style={s.subtitle}>
                    No published lessons for this selection.
                  </Text>
                ) : null}
                {timetable.map((item, index) => (
                  <SchoolRow
                    key={item.id || index}
                    icon={
                      /math/i.test(item.subject)
                        ? '📐'
                        : /science/i.test(item.subject)
                        ? '🔬'
                        : /break/i.test(item.subject)
                        ? '🍎'
                        : /urdu/i.test(item.subject)
                        ? '✏️'
                        : '📚'
                    }
                    title={item.subject || item.title || 'Lesson'}
                    subtitle={[
                      `${item.startTime || ''}–${item.endTime || ''}`,
                      item.day || item.weekday,
                      typeof item.teacher === 'string'
                        ? item.teacher
                        : item.teacherName || item.teacher?.fullName,
                      item.room,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    badge="Scheduled"
                    action="Open"
                    last={index === timetable.length - 1}
                    onPress={() => setLesson(item)}
                  />
                ))}
              </SchoolPanel>
            </>
          )}
        </>
      ) : null}
      {previewOnly ? (
        <Text style={s.preview}>
          Development design preview · fictional local records
        </Text>
      ) : null}
      <Modal
        visible={!!lesson}
        transparent
        animationType="fade"
        onRequestClose={() => setLesson(null)}
      >
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            accessibilityRole="button"
            accessibilityLabel="Close lesson"
            onPress={() => setLesson(null)}
          />
          <View style={styles.sheet}>
            <Text style={s.title}>{lesson?.subject || 'Lesson'}</Text>
            <Text style={s.subtitle}>
              {lesson?.day} · {lesson?.startTime}–{lesson?.endTime}
            </Text>
            <Text style={s.subtitle}>
              {lesson?.description ||
                lesson?.topic ||
                'Details from your published class timetable.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setLesson(null)}
            >
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  link: {
    color: c.primary,
    fontSize: 12,
    fontWeight: '800',
    paddingVertical: 8,
  },
  selector: {
    background: '#EDF4E3',
    padding: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  smallAvatar: { fontSize: 20 },
  selectorName: { color: c.ink, fontWeight: '800', fontSize: 13 },
  selectorMeta: { color: c.muted, fontSize: 11, lineHeight: 17 },
  overlay: {
    flex: 1,
    backgroundColor: '#252B5260',
    justifyContent: 'flex-end',
  },
  sheet: {
    padding: 22,
    paddingBottom: 34,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: c.background,
    maxHeight: '75%',
  },
  childCard: {
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: '#FFFEFA',
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 23,
    minHeight: 220,
    shadowColor: '#C5B397',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 2,
  },
  selectedCard: { borderColor: '#BFC7FF' },
  portrait: { width: '31%', alignItems: 'center', justifyContent: 'center' },
  boyPortrait: { backgroundColor: '#FFE4AA' },
  girlPortrait: { backgroundColor: '#E0E5FF' },
  sparkle: {
    position: 'absolute',
    right: 16,
    top: 22,
    fontSize: 24,
    color: '#fff',
  },
  childAvatar: { fontSize: 62 },
  childCopy: { flex: 1, padding: 18 },
  badgeWrap: { alignItems: 'flex-start' },
  childName: { fontSize: 19, fontWeight: '800', color: c.ink, marginTop: 12 },
  childInfo: { fontSize: 11, color: c.muted, lineHeight: 17, marginTop: 5 },
  childMetrics: { flexDirection: 'row', gap: 22, marginVertical: 13 },
  metricValue: { fontSize: 22, fontWeight: '800', color: c.primary },
  metricLabel: { fontSize: 10, color: c.muted, marginTop: 5 },
  hero: {
    backgroundColor: '#FFEAC4',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F4DCB2',
    minHeight: 224,
  },
  heroArt: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '53%',
    opacity: 0.95,
  },
  heroCopy: { width: '66%', padding: 20, backgroundColor: '#FFEAC4DD' },
  overline: {
    fontSize: 8,
    letterSpacing: 1.4,
    fontWeight: '800',
    color: '#A27C3C',
  },
  heroTitle: {
    color: c.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    marginTop: 12,
  },
  heroText: { fontSize: 12, lineHeight: 18, color: '#917E5E', marginTop: 9 },
  heroButton: {
    alignSelf: 'flex-start',
    backgroundColor: c.primary,
    padding: 10,
    borderRadius: 14,
    marginTop: 13,
  },
  heroButtonText: { fontSize: 11, color: '#fff', fontWeight: '800' },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  panelTitle: { fontSize: 16, color: c.ink, fontWeight: '800' },
  monthControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthButton: {
    fontSize: 25,
    color: c.primary,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  calendar: { flexDirection: 'row', flexWrap: 'wrap', gap: '2%' },
  dayCell: {
    width: '12.5%',
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  dayBox: { minHeight: 43, borderRadius: 9, backgroundColor: '#F1F1EF' },
  weekday: { fontSize: 12, fontWeight: '800', color: '#88987C' },
  dayNumber: { fontSize: 13, color: c.ink },
  present: { backgroundColor: '#F0F5E9' },
  absent: { backgroundColor: '#FFE5DF' },
  late: { backgroundColor: '#FFF0CA' },
  leave: { backgroundColor: '#EAE9FA' },
  excused: { backgroundColor: '#EAE9FA' },
  unmarked: { backgroundColor: '#F1F1EF' },
  mixed: { backgroundColor: '#E1EBF7' },
  selectedDay: { backgroundColor: c.primary },
  selectedDayText: { color: '#fff' },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    alignItems: 'center',
    marginTop: 7,
  },
  legendBadge: { padding: 7, borderRadius: 5 },
  legendText: { fontSize: 10, fontWeight: '800', color: c.ink },
  dayFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayFilter: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: '#fff',
  },
  dayFilterActive: { backgroundColor: c.primary, borderColor: c.primary },
  dayFilterText: { fontSize: 12, fontWeight: '700', color: c.primary },
});
