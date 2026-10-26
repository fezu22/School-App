import PageIcon from '../shared/components/PageIcon';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme as t } from '../theme/hiraTheme';
import { features } from './featureScreens';
import { getFeatureProvider } from './featureProviders';
import { parentApi } from '../roles/parent/parentService';

const exampleEvents = [
  {
    id: 'preview-science',
    title: 'Science Fair',
    subtitle: 'Academic · School',
    date: '2026-10-15',
    status: 'Open',
  },
  {
    id: 'preview-ptm',
    title: 'Parent–Teacher Meetings',
    subtitle: 'Teacher appointments',
    date: '2026-10-07',
    status: 'Published',
  },
  {
    id: 'preview-sport',
    title: 'Sports Day',
    subtitle: 'Sports · School',
    date: '2026-10-22',
    status: 'Open',
  },
];
function sample(page, type) {
  if (type === 'calendar' || type === 'events' || type === 'appointments')
    return { records: exampleEvents };
  if (type === 'quiz')
    return {
      records: [
        {
          id: 'preview-quiz',
          title: 'Mathematics practice',
          question: 'What is ½ + ¼?',
          options: ['1/4', '2/4', '3/4', '4/4'],
          answer: '3/4',
          status: 'Practice',
        },
      ],
    };
  if (type === 'resources' || type === 'classroom')
    return {
      records: [
        {
          id: 'preview-maths',
          title: 'Mathematics',
          subtitle: 'Fractions · Practice lesson',
          status: 'Assigned',
          body: 'Read the lesson, then practise questions 1–5.',
        },
        {
          id: 'preview-science',
          title: 'Science',
          subtitle: 'Our natural world · Learning resource',
          status: 'Assigned',
          body: 'Explore today’s lesson with your teacher.',
        },
      ],
    };
  if (type === 'report')
    return {
      records: [
        {
          id: 'preview-report',
          title: 'Mathematics',
          subtitle: 'September 2026',
          body: 'Strong participation; practise written solution steps.',
          value: 82,
          status: 'Published',
        },
        {
          id: 'preview-reading',
          title: 'Reading',
          subtitle: 'September 2026',
          body: 'Confident reading and steady progress.',
          value: 76,
          status: 'Published',
        },
      ],
      metrics: {
        'Overall score': '82%',
        Attendance: '94%',
        'Completed work': '8/10',
        Participation: 'Good',
        Teamwork: 'Good',
        Responsibility: 'Growing',
        Academic: 'Published',
        Personal: 'Published',
        Published: '2',
        Assignments: '8/10',
        'Latest result': '82%',
      },
    };
  return { records: [] };
}
function Button({ children, onPress, secondary, disabled }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        disabled && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Text style={[s.buttonText, secondary && { color: t.primary }]}>
        {children}
      </Text>
    </Pressable>
  );
}
export default function FeaturePage({
  role,
  page,
  previewOnly = false,
  provider: customProvider,
  childId,
  definition,
  onNavigate,
}) {
  const [selectedParentChildId, setSelectedParentChildId] = useState(childId || '');
  const [parentChildren, setParentChildren] = useState([]);
  const [parentChildrenLoading, setParentChildrenLoading] = useState(false);
  const [parentChildrenError, setParentChildrenError] = useState('');
  const [parentChildrenRetry, setParentChildrenRetry] = useState(0);
  const parentScopedPage = role === 'Parent' && [
    'Academic Report',
    'Monthly Feedback',
    'Student Progress Tracking',
    'Student Fees',
    'Receipt Details',
    'Attendance Calendar',
    'Leave Request',
    'Academic Calendar',
    'School Events',
    'Sports & Activities',
    'PTM & Appointments',
    'Learning Resources',
    'Recorded Lessons',
    'Documents & Consent',
    'Helpdesk',
    'Track My Child',
    'Travel History',
    'Transport & Alerts',
  ].includes(page);
  const parentReceiptPage = role === 'Parent' && page === 'Receipt Details';
  const provider = useMemo(
    () => parentScopedPage
      ? getFeatureProvider(role, page, selectedParentChildId)
      : customProvider || getFeatureProvider(role, page, selectedParentChildId),
    [customProvider, role, page, selectedParentChildId, parentScopedPage],
  );
  const config = definition || features[page];
  const [data, setData] = useState({ records: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({});
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [largeText, setLargeText] = useState(false);
  const [quietHours, setQuietHours] = useState(false);
  const [quizChoice, setQuizChoice] = useState('');
  const version = useRef(0);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    setSelectedParentChildId(childId || '');
  }, [childId, page, role]);
  useEffect(() => {
    if (role !== 'Parent' || previewOnly) return undefined;
    let active = true;
    setParentChildrenLoading(true);
    setParentChildrenError('');
    parentApi.getChildren().then((children) => {
      if (!active) return;
      const linked = Array.isArray(children) ? children : [];
      setParentChildren(linked);
      const preferred = childId || selectedParentChildId;
      const nextId = linked.some((child) => child.id === preferred)
        ? preferred
        : linked[0]?.id || '';
      setSelectedParentChildId(nextId);
    }).catch((failure) => {
      if (!active) return;
      setParentChildren([]);
      setSelectedParentChildId('');
      setParentChildrenError(failure.message || 'Could not load linked children.');
    }).finally(() => {
      if (active) setParentChildrenLoading(false);
    });
    return () => { active = false; };
  }, [role, page, previewOnly, childId, parentChildrenRetry, selectedParentChildId]);
  useEffect(() => {
    if (parentScopedPage) setData({ records: [] });
  }, [selectedParentChildId, parentScopedPage]);
  const load = useCallback(
    async (filters = {}) => {
      const current = ++version.current;
      setError('');
      if (previewOnly) {
        const preview = sample(page, config.type);
        const searchFields = [
          'Search',
          'Subject',
          'Status',
          'Resource type',
          'Type',
          'Category',
        ];
        const terms = searchFields
          .map((field) =>
            String(filters[field] || '')
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean);
        setData({
          ...preview,
          records: terms.length
            ? preview.records.filter((record) =>
                terms.every((term) =>
                  JSON.stringify(record).toLowerCase().includes(term),
                ),
              )
            : preview.records,
        });
        return;
      }
      if (!provider?.load) {
        setData({ records: [] });
        return;
      }
      setLoading(true);
      try {
        const result = await provider.load(filters);
        if (version.current === current)
          setData(
            Array.isArray(result)
              ? { records: result }
              : result || { records: [] },
          );
      } catch (failure) {
        if (version.current === current) {
          setData({ records: [], metrics: null });
          setError(failure.message || 'Could not load this page.');
        }
      } finally {
        if (version.current === current) setLoading(false);
      }
    },
    [page, previewOnly, provider, config.type],
  );
  useEffect(() => {
    load();
    return () => {
      version.current += 1;
    };
  }, [load]);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (alive)
        Animated.timing(appear, {
          toValue: 1,
          duration: reduced ? 0 : 320,
          useNativeDriver: true,
        }).start();
    });
    return () => {
      alive = false;
    };
  }, [appear]);
  async function submit() {
    setNotice('');
    setError('');
    const required = config.fields || [];
    if (required.some((field) => !String(form[field] || '').trim())) {
      setError('Please complete all fields.');
      return;
    }
    if (previewOnly) {
      setNotice('Preview updated locally. Nothing was sent to the school.');
      return;
    }
    if (!provider?.submit) {
      setError('This action needs the school’s authorized service.');
      return;
    }
    setLoading(true);
    try {
      const result = await provider.submit(form);
      if (result) setData(Array.isArray(result) ? { records: result } : result);
      setNotice(
        result?.notice || 'The connected school service completed the request.',
      );
    } catch (failure) {
      setError(failure.message || 'Could not complete this action.');
    } finally {
      setLoading(false);
    }
  }
  async function performRecordAction(action, success) {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await action();
      setSelected(null);
      setNotice(success);
      await load(form);
    } catch (failure) {
      setError(failure.message || 'Could not complete this action.');
    } finally {
      setLoading(false);
    }
  }
  const records = Array.isArray(data.records) ? data.records : [];
  const eventRecords = records.filter(
    (item) =>
      item.date &&
      new Date(item.date).getMonth() === month.getMonth() &&
      new Date(item.date).getFullYear() === month.getFullYear(),
  );
  const card = (item) => (
    <Pressable
      key={item.id || item._id || item.title}
      accessibilityRole="button"
      onPress={() => setSelected(item)}
      style={s.record}
    >
      <View style={s.recordIcon}>
        <PageIcon name={page} size={25} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.recordTitle}>
          {item.title || item.subject || item.name || 'Record'}
        </Text>
        <Text style={s.muted}>
          {item.subtitle || item.date || item.description || ''}
        </Text>
        {item.body || item.feedback ? (
          <Text style={s.bodyText}>{item.body || item.feedback}</Text>
        ) : null}
        {item.value != null ? (
          <View style={s.track}>
            <View
              style={[
                s.bar,
                {
                  width: `${Math.max(
                    0,
                    Math.min(100, Number(item.value) || 0),
                  )}%`,
                },
              ]}
            />
          </View>
        ) : null}
      </View>
      <View style={s.recordAction}>
        <Text numberOfLines={1} style={s.status}>{item.status || 'View'}</Text>
        <PageIcon name="chevron" size={15} />
      </View>
    </Pressable>
  );
  return (
    <KeyboardAvoidingView
      style={s.keyboard}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => load(form)}
            tintColor={t.primary}
          />
        }
      >
        <Animated.View
          style={{
            opacity: appear,
            transform: [
              {
                translateY: appear.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          }}
        >
          <View style={s.pageHeader}>
            <View style={s.headerCopy}>
              <Text style={s.eyebrow}>
                {role.toUpperCase()} · {page.toUpperCase()}
              </Text>
              <Text style={[s.title, largeText && { fontSize: 32 }]}>
                {config.title}
              </Text>
              <Text style={s.subtitle}>{config.subtitle}</Text>
            </View>
            <View style={s.headerIcon}>
              <PageIcon name={page} size={34} />
            </View>
          </View>
          <View style={s.tabs}>
            {['Overview', 'History'].map((item) => (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === item }}
                onPress={() => setTab(item)}
                style={[s.tab, tab === item && s.activeTab]}
              >
                <Text style={[s.tabText, tab === item && { color: 'white' }]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
          {!previewOnly && !provider?.load && !provider?.submit ? (
            <View style={s.info}>
              <Text style={s.infoTitle}>Not available yet</Text>
              <Text style={s.muted}>
                This page does not have a connected school API yet. No school
                records are shown here.
              </Text>
            </View>
          ) : null}
          {error ? (
            <View accessibilityRole="alert" style={s.error}>
              <Text style={{ color: '#A13B42' }}>{error}</Text>
              <Button secondary onPress={() => load(form)}>
                Retry
              </Button>
            </View>
          ) : null}
          {notice ? (
            <Text accessibilityRole="alert" style={s.notice}>
              {notice}
            </Text>
          ) : null}
          {loading ? <ActivityIndicator color={t.primary} /> : null}
          {parentScopedPage && !previewOnly ? (
            <View style={s.panel}>
              <Text style={s.section}>Linked child</Text>
              {parentChildrenLoading ? <ActivityIndicator color={t.primary} /> : null}
              {parentChildrenError ? (
                <View accessibilityRole="alert" style={s.error}>
                  <Text style={{ color: '#A13B42' }}>{parentChildrenError}</Text>
                  <Button secondary onPress={() => setParentChildrenRetry((count) => count + 1)}>Retry linked children</Button>
                </View>
              ) : null}
              {parentChildren.map((child) => (
                <Pressable
                  key={child.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: child.id === selectedParentChildId }}
                  disabled={loading || parentChildrenLoading}
                  onPress={() => {
                    setSelectedParentChildId(child.id);
                    setData({ records: [] });
                    setError('');
                  }}
                  style={s.setting}
                >
                  <Text style={s.recordTitle}>{child.fullName || child.name || 'Child'}</Text>
                  <Text style={s.muted}>{[child.grade, child.section && `Section ${child.section}`].filter(Boolean).join(' · ')}</Text>
                  {child.id === selectedParentChildId ? <Text style={s.status}>Selected</Text> : null}
                </Pressable>
              ))}
              {!parentChildrenLoading && !parentChildrenError && !parentChildren.length ? (
                <Text style={s.muted}>No verified children are linked to this account.</Text>
              ) : null}
            </View>
          ) : null}
          {error && provider?.load ? (
            <Button secondary disabled={loading} onPress={() => load(form)}>
              Retry loading records
            </Button>
          ) : null}
          {config.filters && tab === 'Overview' ? (
            <View style={s.panel}>
              <Text style={s.section}>Find what you need</Text>
              <View style={s.fields}>
                {config.filters.map((field) => (
                  <View key={field} style={s.filter}>
                    <Text style={s.label}>{field}</Text>
                    <TextInput
                      accessibilityLabel={field}
                      placeholder={field}
                      placeholderTextColor={t.muted}
                      value={form[field] || ''}
                      onChangeText={(value) =>
                        setForm((current) => ({ ...current, [field]: value }))
                      }
                      style={s.input}
                    />
                  </View>
                ))}
              </View>
              <Button
                secondary
                onPress={() => {
                  load(form);
                }}
              >
                Apply filters
              </Button>
            </View>
          ) : null}
          {config.metrics && tab === 'Overview' ? (
            <View style={s.metrics}>
              {config.metrics.map((label, index) => (
                <View
                  key={label}
                  style={[
                    s.metric,
                    {
                      backgroundColor: ['#E9ECFF', '#FFF0D4', '#E6F2EA'][
                        index % 3
                      ],
                    },
                  ]}
                >
                  <Text style={s.metricValue}>
                    {data.metrics?.[label] ?? '—'}
                  </Text>
                  <Text style={s.metricLabel}>{label}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {config.type === 'calendar' && tab === 'Overview' ? (
            <View style={s.panel}>
              <View style={s.monthHeading}>
                <Button
                  secondary
                  onPress={() =>
                    setMonth(
                      new Date(month.getFullYear(), month.getMonth() - 1, 1),
                    )
                  }
                >
                  ‹
                </Button>
                <Text style={s.monthTitle}>
                  {month.toLocaleDateString(undefined, {
                    month: 'long',
                    year: 'numeric',
                  })}
                </Text>
                <Button
                  secondary
                  onPress={() =>
                    setMonth(
                      new Date(month.getFullYear(), month.getMonth() + 1, 1),
                    )
                  }
                >
                  ›
                </Button>
              </View>
              <View style={s.calendar}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                  <Text key={`day-${i}`} style={s.dayLabel}>
                    {day}
                  </Text>
                ))}
                {Array.from({ length: month.getDay() }, (_, i) => (
                  <View key={`blank-${i}`} style={s.day} />
                ))}
                {Array.from(
                  {
                    length: new Date(
                      month.getFullYear(),
                      month.getMonth() + 1,
                      0,
                    ).getDate(),
                  },
                  (_, i) => {
                    const events = eventRecords.filter(
                      (item) => new Date(item.date).getDate() === i + 1,
                    );
                    return (
                      <Pressable
                        key={i}
                        accessibilityRole="button"
                        accessibilityLabel={`${i + 1}, ${events.length} events`}
                        onPress={() =>
                          events.length
                            ? setSelected(events[0])
                            : setNotice('No published event for this date.')
                        }
                        style={[
                          s.day,
                          events.length > 0 && { backgroundColor: '#FFF0CF' },
                        ]}
                      >
                        <Text style={s.dayText}>{i + 1}</Text>
                        {events.length ? (
                          <Text style={{ color: t.primary }}>•</Text>
                        ) : null}
                      </Pressable>
                    );
                  },
                )}
              </View>
            </View>
          ) : null}
          {config.type === 'travel' && tab === 'Overview' ? (
            <View style={s.map}>
              <View style={s.mapRoad} />
              <PageIcon name="bus" size={54} />
              <Text style={s.mapLabel}>School trip status</Text>
              <Text style={s.muted}>
                No live location shown without a confirmed trip and fresh GPS
                data.
              </Text>
            </View>
          ) : null}
          {config.type === 'scanner' && tab === 'Overview' ? (
            <View style={s.scan}>
              <PageIcon name="scan" size={64} />
              <Text style={s.section}>Voucher verification</Text>
              <Text style={s.muted}>
                Enter the voucher code below. Camera scanning requires a
                separate native scanner integration.
              </Text>
            </View>
          ) : null}
          {config.type === 'settings' && tab === 'Overview' ? (
            <View style={s.panel}>
              {[
                ['Larger text', largeText, setLargeText],
                ['Quiet hours', quietHours, setQuietHours],
              ].map(([label, value, setter]) => (
                <View key={label} style={s.setting}>
                  <Text style={s.recordTitle}>{label}</Text>
                  <Switch
                    accessibilityLabel={label}
                    value={value}
                    onValueChange={setter}
                    trackColor={{ true: t.primary }}
                  />
                </View>
              ))}
              <Text style={s.muted}>
                These controls update this screen locally. Account preference
                persistence requires a settings provider.
              </Text>
            </View>
          ) : null}
          {config.type === 'classroom' && tab === 'Overview' ? (
            <View style={s.classroom}>
              <PageIcon name="video" size={50} />
              <Text style={s.recordTitle}>Your live lesson</Text>
              <Text style={s.muted}>Select an assigned session below.</Text>
            </View>
          ) : null}
          {config.type === 'quiz' && records[0] && tab === 'Overview' ? (
            <View style={s.panel}>
              <Text style={s.section}>
                {records[0].question || records[0].title}
              </Text>
              {(records[0].options || []).map((option) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: quizChoice === option }}
                  key={option}
                  onPress={() => setQuizChoice(option)}
                  style={[
                    s.answer,
                    quizChoice === option && {
                      borderColor: t.primary,
                      backgroundColor: t.lavender,
                    },
                  ]}
                >
                  <Text style={s.recordTitle}>{option}</Text>
                </Pressable>
              ))}
              {quizChoice && previewOnly ? (
                <Text style={s.notice}>
                  {quizChoice === records[0].answer
                    ? '✓ Great work!'
                    : 'Try a common denominator.'}
                </Text>
              ) : null}
              {quizChoice && !previewOnly && provider?.submitQuiz ? (
                <Button
                  disabled={loading}
                  onPress={() => performRecordAction(
                    () => provider.submitQuiz(records[0], quizChoice),
                    'Quiz attempt scored and saved.',
                  )}
                >
                  Submit answer
                </Button>
              ) : null}
            </View>
          ) : null}
          {role === 'Parent' && page === 'Online Payment' ? (
            <View style={s.info}>
              <Text style={s.infoTitle}>Online payment is not available yet</Text>
              <Text style={s.muted}>
                No payment provider is connected. This screen will not start, record, or simulate a payment. You can still review invoices and confirmed receipts.
              </Text>
              <Button secondary onPress={() => onNavigate('Student Fees')}>View invoices</Button>
            </View>
          ) : null}
          {config.fields && tab === 'Overview' && !parentReceiptPage && !(role === 'Parent' && page === 'Online Payment') ? (
            <View style={s.panel}>
              <Text style={s.section}>
                {config.type === 'messages'
                  ? 'Start a conversation'
                  : config.type === 'tutor'
                  ? 'What are you curious about?'
                  : 'Details'}
              </Text>
              {config.fields.map((field) => (
                <View key={field} style={{ marginBottom: 14 }}>
                  <Text style={s.label}>{field}</Text>
                  <TextInput
                    accessibilityLabel={field}
                    placeholder={field}
                    placeholderTextColor={t.muted}
                    multiline={/Message|Reason|Question|Note/.test(field)}
                    textAlignVertical="top"
                    value={form[field] || ''}
                    onChangeText={(value) =>
                      setForm((current) => ({ ...current, [field]: value }))
                    }
                    style={[
                      s.input,
                      /Message|Reason|Question|Note/.test(field) && {
                        minHeight: 105,
                      },
                    ]}
                  />
                </View>
              ))}
              <Button
                disabled={loading || (!previewOnly && !provider?.submit)}
                onPress={submit}
              >
                {config.action || 'Save'}
              </Button>
            </View>
          ) : null}
          <Text style={s.section}>
            {tab === 'History'
              ? 'Record history'
              : config.type === 'calendar'
              ? 'Upcoming dates'
              : parentReceiptPage
              ? 'Confirmed receipts'
              : 'Your records'}
          </Text>
          {(tab === 'History'
            ? data.history || []
            : config.type === 'calendar'
            ? eventRecords
            : records
          ).map(card)}
          {(tab === 'History'
            ? data.history || []
            : config.type === 'calendar'
            ? eventRecords
            : records
          ).length === 0 && !loading && !error ? (
            <View style={s.empty}>
              <PageIcon name={page} size={34} />
              <Text style={s.recordTitle}>No records to show yet</Text>
              <Text style={s.muted}>
                {previewOnly
                  ? 'Preview only. No records will be saved to the school database.'
                  : provider?.load
                  ? 'No authorized records are available for this account.'
                  : 'Your school data will appear after the service is connected.'}
              </Text>
            </View>
          ) : null}
          <Button secondary onPress={() => onNavigate('Home')}>
            Back to Overview
          </Button>
          {previewOnly ? (
            <Text style={s.preview}>Design preview · local sample content</Text>
          ) : null}
        </Animated.View>
      </ScrollView>
      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View style={s.overlay}>
          <View style={s.detail}>
            <Text style={s.eyebrow}>RECORD DETAILS</Text>
            <Text style={s.title}>{selected?.title || selected?.subject}</Text>
            <Text style={s.subtitle}>
              {selected?.subtitle || selected?.date}
            </Text>
            <Text style={s.bodyText}>
              {selected?.body ||
                selected?.description ||
                selected?.feedback ||
                'No additional details are available.'}
            </Text>
            {selected?.status ? (
              <Text style={s.status}>{selected.status}</Text>
            ) : null}
            {provider?.requestRecord ? (
              <Button
                disabled={loading}
                onPress={() => performRecordAction(
                  () => provider.requestRecord(selected),
                  'Request saved for staff review.',
                )}
              >
                Request registration
              </Button>
            ) : null}
            {provider?.recordConsent ? (
              <>
                <Button
                  disabled={loading || !selected?.version}
                  onPress={() => performRecordAction(
                    () => provider.recordConsent(selected, 'accepted'),
                    'Consent decision saved for this exact document version.',
                  )}
                >
                  Accept this version
                </Button>
                <Button
                  secondary
                  disabled={loading || !selected?.version}
                  onPress={() => performRecordAction(
                    () => provider.recordConsent(selected, 'declined'),
                    'Consent decision saved for this exact document version.',
                  )}
                >
                  Decline this version
                </Button>
              </>
            ) : null}
            <Button onPress={() => setSelected(null)}>Close</Button>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  keyboard: { flex: 1 },
  page: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 35 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 20,
  },
  headerCopy: { flex: 1 },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 21,
    backgroundColor: t.lavender,
    borderWidth: 1,
    borderColor: '#DFDCF9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    color: t.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    color: t.ink,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '900',
    marginTop: 8,
  },
  subtitle: {
    color: t.muted,
    fontSize: 13,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 18,
  },
  bodyText: { color: '#77757D', fontSize: 13, lineHeight: 20, marginTop: 5 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#F0ECDF',
    borderRadius: 15,
    padding: 4,
    marginBottom: 18,
  },
  tab: { flex: 1, minHeight: 42, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  activeTab: { backgroundColor: t.primary, ...t.shadow },
  tabText: { color: '#68677A', fontSize: 12, fontWeight: '700' },
  panel: {
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    ...t.shadow,
  },
  section: {
    fontSize: 17,
    fontWeight: '800',
    color: t.ink,
    marginBottom: 12,
    marginTop: 4,
  },
  fields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  filter: { width: '48%', marginBottom: 14 },
  label: { color: '#777480', fontSize: 11, marginBottom: 7, fontWeight: '600' },
  input: {
    minHeight: 48,
    color: t.ink,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 14,
    padding: 12,
    fontSize: 14,
  },
  button: {
    minHeight: 46,
    backgroundColor: t.primary,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 17,
    alignSelf: 'flex-start',
    marginTop: 8,
    ...t.shadow,
  },
  secondary: {
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
  },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 12 },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  metric: { flexGrow: 1, minWidth: '46%', padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#E8E4EE' },
  metricValue: { color: t.primary, fontSize: 22, fontWeight: '800' },
  metricLabel: { color: '#817D88', fontSize: 11, lineHeight: 16, marginTop: 7 },
  record: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    padding: 14,
    borderRadius: 18,
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 12,
    ...t.shadow,
  },
  recordIcon: {
    width: 42,
    height: 42,
    backgroundColor: t.lavender,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 25 },
  recordTitle: { color: t.ink, fontWeight: '800', fontSize: 14, lineHeight: 20 },
  muted: { color: t.muted, fontSize: 12, lineHeight: 19, marginTop: 5 },
  recordAction: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingTop: 4, maxWidth: 92 },
  status: { color: t.primary, fontSize: 10, fontWeight: '800', maxWidth: 68 },
  track: {
    height: 8,
    borderRadius: 5,
    backgroundColor: t.lavender,
    overflow: 'hidden',
    marginTop: 12,
  },
  bar: { height: 8, backgroundColor: t.primary },
  monthHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  monthTitle: { color: t.ink, fontSize: 16, fontWeight: '800' },
  calendar: { flexDirection: 'row', flexWrap: 'wrap' },
  dayLabel: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 10,
    color: t.muted,
    marginBottom: 12,
  },
  day: {
    width: '14.28%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  dayText: { color: t.ink, fontSize: 12 },
  info: {
    padding: 16,
    backgroundColor: '#FFF0D4',
    borderRadius: 18,
    marginBottom: 18,
  },
  infoTitle: { color: '#8B7044', fontSize: 13, fontWeight: '700' },
  error: {
    backgroundColor: '#FFF0EF',
    padding: 15,
    borderRadius: 18,
    marginBottom: 16,
    gap: 10,
  },
  notice: {
    color: '#52724A',
    backgroundColor: '#EEF5E8',
    padding: 13,
    borderRadius: 13,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 15,
  },
  empty: {
    alignItems: 'center',
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 22,
    padding: 25,
    gap: 8,
    marginBottom: 20,
  },
  map: {
    backgroundColor: '#DDEDDD',
    borderRadius: 24,
    minHeight: 220,
    padding: 25,
    alignItems: 'center',
    marginBottom: 20,
    overflow: 'hidden',
  },
  mapRoad: {
    position: 'absolute',
    width: '120%',
    height: 28,
    backgroundColor: '#FFF9EE',
    top: 80,
    transform: [{ rotate: '-20deg' }],
  },
  bus: { fontSize: 54 },
  mapLabel: { color: t.ink, fontSize: 18, fontWeight: '800', marginTop: 20 },
  scan: {
    borderColor: t.primary,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 23,
    padding: 22,
    alignItems: 'center',
    marginBottom: 20,
  },
  classroom: {
    backgroundColor: '#E5E8FC',
    padding: 25,
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    gap: 12,
    marginBottom: 20,
  },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 10,
  },
  answer: {
    padding: 15,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 15,
    marginBottom: 10,
  },
  overlay: {
    flex: 1,
    backgroundColor: '#28294066',
    justifyContent: 'center',
    padding: 22,
  },
  detail: {
    backgroundColor: t.background,
    padding: 24,
    borderRadius: 27,
    gap: 15,
  },
  preview: { textAlign: 'center', color: t.muted, fontSize: 10, marginTop: 20 },
});
