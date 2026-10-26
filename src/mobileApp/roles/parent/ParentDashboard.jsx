import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { parentApi } from './parentService';
import {
  APPLICATION_MESSAGE_LIMIT,
  APPLICATION_TITLE_LIMIT,
  validateApplicationDraft,
} from '../../shared/utils/applicationValidation';
import { parentPreview, previewNotifications } from '../../shared/data/previewData';
import SchoolPageHero from '../../shared/components/SchoolPageHero';

const colors = {
  ink: '#282940',
  muted: '#92918A',
  blue: '#4857B5',
  pale: '#FFF9EF',
  line: '#E6E2D7',
  green: '#168A62',
  red: '#B42318',
};

function Empty({ children }) {
  return <Text style={styles.empty}>{children}</Text>;
}

const asList = value => (Array.isArray(value) ? value : []);

const childResourcesByPage = {
  Attendance: ['profile', 'attendance'],
  Timetable: ['profile', 'timetable'],
  Results: ['profile', 'results'],
  Progress: ['profile', 'progress'],
  Homework: ['profile', 'homework'],
  Fees: ['profile', 'fees'],
  Applications: ['profile', 'applications'],
  'My children': ['profile', 'attendance', 'timetable', 'results', 'progress'],
};

function requestedChildResources(page) {
  return (
    childResourcesByPage[page] || [
      'profile',
      'attendance',
      'timetable',
      'homework',
      'results',
      'progress',
      'fees',
      'feedback',
      'applications',
    ]
  );
}

function previewChildRecords(childId) {
  const records = parentPreview.records[childId];
  return records
    ? { ...records, progress: asList(records.progress || records.feedback?.progress) }
    : null;
}

function DataCard({ title, lines = [], status, feedback }) {
  return (
    <View style={styles.dataCard}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
      {lines.filter(Boolean).map((line, index) => (
        <Text key={`${title}-${index}`} style={styles.cardLine}>
          {line}
        </Text>
      ))}
      {feedback ? (
        <View style={styles.feedback}>
          <Text style={styles.feedbackLabel}>Teacher feedback</Text>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Section({
  title,
  activePage,
  records,
  empty,
  render,
  error,
  onRetry,
}) {
  const sectionPage = {
    Timetable: 'Timetable',
    Attendance: 'Attendance',
    Homework: 'Homework',
    'Published results': 'Results',
    Progress: 'Progress',
    Fees: 'Fees',
    'Application status history': 'Applications',
    'Application history': 'Applications',
  }[title];
  if (
    activePage &&
    activePage !== 'All' &&
    activePage !== 'My children' &&
    activePage !== sectionPage &&
    !(activePage === 'Timetable' && title === 'Timetable')
  )
    return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={styles.refresh}>Retry</Text>
          </Pressable>
        </View>
      ) : records.length ? (
        records.map(render)
      ) : (
        <Empty>{empty}</Empty>
      )}
    </View>
  );
}

function money(amount, currency = 'PKR') {
  return `${currency} ${Number(amount || 0).toLocaleString()}`;
}

export default function ParentDashboard({
  previewOnly = false,
  searchQuery = '',
  page = 'All',
  initialChildId = '',
}) {
  const [children, setChildren] = useState(
    previewOnly ? parentPreview.children : [],
  );
  const [selectedChildId, setSelectedChildId] = useState(
    previewOnly
      ? initialChildId || parentPreview.children[0].id
      : initialChildId,
  );
  const [childRecords, setChildRecords] = useState(
    previewOnly
      ? previewChildRecords(initialChildId || parentPreview.children[0].id)
      : null,
  );
  const [childrenLoading, setChildrenLoading] = useState(!previewOnly);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [childrenError, setChildrenError] = useState('');
  const [recordsError, setRecordsError] = useState('');
  const [recordErrors, setRecordErrors] = useState({});
  const [notifications, setNotifications] = useState(
    previewOnly ? previewNotifications : [],
  );
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(
    previewOnly ? previewNotifications.length : 0,
  );
  const [notificationsLoading, setNotificationsLoading] = useState(
    !previewOnly,
  );
  const [notificationsError, setNotificationsError] = useState('');
  const [openedDlp, setOpenedDlp] = useState(null);
  const [dlpLoadingId, setDlpLoadingId] = useState('');
  const [dlpError, setDlpError] = useState('');
  const [applicationTitle, setApplicationTitle] = useState('');
  const [applicationMessage, setApplicationMessage] = useState('');
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationNotice, setApplicationNotice] = useState('');
  const [feeGateway, setFeeGateway] = useState(null);
  const [feeGatewayLoading, setFeeGatewayLoading] = useState(!previewOnly);
  const [feeGatewayError, setFeeGatewayError] = useState('');
  const [feeInvoice, setFeeInvoice] = useState(null);
  const [feeFlowStep, setFeeFlowStep] = useState('invoice');
  const [feeMethod, setFeeMethod] = useState('card');
  const [feeCheckoutLoading, setFeeCheckoutLoading] = useState(false);
  const [feePaymentId, setFeePaymentId] = useState('');
  const [feePaymentState, setFeePaymentState] = useState('idle');
  const [feePaymentError, setFeePaymentError] = useState('');
  const [feePaymentReceipt, setFeePaymentReceipt] = useState(null);
  const requestVersion = useRef(0);
  const childrenVersion = useRef(0);
  const notificationVersion = useRef(0);

  const loadChild = useCallback(
    async childId => {
      if (previewOnly) {
        setSelectedChildId(childId);
        setChildRecords(previewChildRecords(childId));
        setFeeInvoice(null);
        setFeePaymentId('');
        setFeePaymentState('idle');
        return;
      }
      const version = ++requestVersion.current;
      notificationVersion.current += 1;
      setOpenedDlp(null);
      setDlpError('');
      setDlpLoadingId('');
      setApplicationTitle('');
      setApplicationMessage('');
      setApplicationNotice('');
      setApplicationError('');
      setFeeInvoice(null);
      setFeePaymentId('');
      setFeePaymentState('idle');
      setFeePaymentError('');
      setFeePaymentReceipt(null);
      setSelectedChildId(childId);
      setChildRecords(null);
      setRecordsError('');
      setRecordErrors({});
      setRecordsLoading(true);
      try {
        const names = requestedChildResources(page);
        const loaders = {
          profile: () => parentApi.getChild(childId),
          attendance: () => parentApi.getAttendance(childId),
          timetable: () => parentApi.getTimetable(childId),
          homework: () => parentApi.getHomework(childId),
          results: () => parentApi.getResults(childId),
          progress: () => parentApi.getProgress(childId),
          fees: () => parentApi.getFees(childId),
          feedback: () => parentApi.getFeedback(childId),
          applications: () => parentApi.getApplications(childId),
        };
        const requests = names.map(name => loaders[name]());
        const settled = await Promise.allSettled(requests);
        if (version !== requestVersion.current) return;
        const nextRecords = {
          profile: null,
          attendance: [],
          timetable: [],
          homework: [],
          results: [],
          progress: [],
          fees: [],
          feedback: { homework: [], results: [], progress: [] },
          applications: [],
        };
        const failures = {};
        settled.forEach((result, index) => {
          const name = names[index];
          if (result.status === 'fulfilled') {
            nextRecords[name] =
              name === 'profile'
                ? result.value
                : name === 'feedback'
                ? {
                    homework: asList(result.value?.homework),
                    results: asList(result.value?.results),
                    progress: asList(result.value?.progress),
                  }
                : asList(result.value);
          } else
            failures[name] =
              result.reason?.message || 'Could not load this section.';
        });
        setChildRecords(nextRecords);
        setRecordErrors(failures);
        if (Object.keys(failures).length === names.length)
          setRecordsError('Could not load this child’s records.');
      } catch (error) {
        if (version === requestVersion.current)
          setRecordsError(
            error.message || 'Could not load this child’s records.',
          );
      } finally {
        if (version === requestVersion.current) setRecordsLoading(false);
      }
    },
    [page, previewOnly],
  );

  const loadNotifications = useCallback(async () => {
    if (previewOnly) return;
    const version = ++notificationVersion.current;
    setNotificationsLoading(true);
    setNotificationsError('');
    try {
      const data = await parentApi.getNotifications();
      if (version === notificationVersion.current) {
        setNotifications(asList(data?.notifications));
        setNotificationUnreadCount(Number(data?.unreadCount) || 0);
      }
    } catch (error) {
      if (version === notificationVersion.current)
        setNotificationsError(error.message);
    } finally {
      if (version === notificationVersion.current)
        setNotificationsLoading(false);
    }
  }, [previewOnly]);

  const loadFeeGateway = useCallback(async () => {
    if (previewOnly) {
      setFeeGateway({
        enabled: false,
        message: 'Payments are disabled in Developer Preview.',
      });
      setFeeGatewayError('');
      setFeeGatewayLoading(false);
      return;
    }
    setFeeGatewayLoading(true);
    setFeeGatewayError('');
    try {
      const config = await parentApi.getFeeCheckoutConfig();
      setFeeGateway(config);
      setFeeMethod(current =>
        config?.methods?.includes(current)
          ? current
          : config?.methods?.[0] || 'card',
      );
    } catch (error) {
      setFeeGateway(null);
      setFeeGatewayError(
        error.message || 'Could not check online payment availability.',
      );
    } finally {
      setFeeGatewayLoading(false);
    }
  }, [previewOnly]);

  const openDlp = useCallback(
    async notification => {
      if (previewOnly) return;
      const notificationId = notification.id || String(notification._id || '');
      if (!notificationId) return;
      const version = ++notificationVersion.current;
      setOpenedDlp(null);
      setDlpError('');
      setDlpLoadingId(notificationId);
      try {
        await parentApi.markNotificationRead(notificationId);
        if (version !== notificationVersion.current) return;
        if (!notification.readAt) {
          const readAt = new Date().toISOString();
          setNotifications(current =>
            current.map(item =>
              (item.id || String(item._id || '')) === notificationId
                ? { ...item, readAt }
                : item,
            ),
          );
          setNotificationUnreadCount(count => Math.max(0, count - 1));
        }
        const data = await parentApi.openNotification(notificationId);
        if (version === notificationVersion.current) setOpenedDlp(data);
      } catch (error) {
        if (version === notificationVersion.current) setDlpError(error.message);
      } finally {
        if (version === notificationVersion.current) setDlpLoadingId('');
      }
    },
    [previewOnly],
  );

  async function submitApplication() {
    if (previewOnly) return;
    if (!selectedChildId) return;
    setApplicationError('');
    setApplicationNotice('');
    const validation = validateApplicationDraft(
      applicationTitle,
      applicationMessage,
    );
    if (validation.error) {
      setApplicationError(validation.error);
      return;
    }
    setApplicationBusy(true);
    try {
      await parentApi.submitApplication(selectedChildId, validation.value);
      setApplicationTitle('');
      setApplicationMessage('');
      setApplicationNotice(
        'Application sent to the selected child’s assigned class teacher.',
      );
      await loadChild(selectedChildId);
    } catch (error) {
      setApplicationError(error.message);
    } finally {
      setApplicationBusy(false);
    }
  }

  const loadChildren = useCallback(async () => {
    if (previewOnly) return;
    const version = ++childrenVersion.current;
    requestVersion.current += 1;
    setChildren([]);
    setSelectedChildId('');
    setChildRecords(null);
    setRecordsLoading(false);
    setRecordsError('');
    setRecordErrors({});
    setChildrenLoading(true);
    setChildrenError('');
    try {
      const data = await parentApi.getChildren();
      if (version !== childrenVersion.current) return;
      const linkedChildren = asList(data);
      setChildren(linkedChildren);
      if (linkedChildren.length)
        await loadChild(
          linkedChildren.find(child => child.id === initialChildId)?.id ||
            linkedChildren[0].id,
        );
      else {
        setSelectedChildId('');
        setChildRecords(null);
        setRecordsLoading(false);
        setRecordsError('');
        setRecordErrors({});
      }
    } catch (error) {
      if (version === childrenVersion.current) {
        setChildren([]);
        setSelectedChildId('');
        setChildRecords(null);
        setRecordsLoading(false);
        setRecordsError('');
        setRecordErrors({});
        setChildrenError(error.message || 'Could not load verified children.');
      }
    } finally {
      if (version === childrenVersion.current) setChildrenLoading(false);
    }
  }, [loadChild, previewOnly, initialChildId]);

  useEffect(() => {
    if (previewOnly) return;
    loadChildren();
    loadNotifications();
    loadFeeGateway();
    return () => {
      requestVersion.current += 1;
      childrenVersion.current += 1;
      notificationVersion.current += 1;
    };
  }, [loadChildren, loadNotifications, loadFeeGateway, previewOnly]);

  useEffect(() => {
    if (!feePaymentId || feePaymentState !== 'pending' || previewOnly)
      return undefined;
    let active = true;
    const checkStatus = async () => {
      try {
        const status = await parentApi.getFeePaymentStatus(feePaymentId);
        if (!active) return;
        if (status?.status === 'confirmed') {
          if (selectedChildId) {
            const fees = await parentApi.getFees(selectedChildId);
            if (active)
              setChildRecords(current =>
                current ? { ...current, fees: asList(fees) } : current,
              );
          }
          if (active) {
            setFeePaymentReceipt(status.receipt || null);
            setFeePaymentState('confirmed');
          }
        } else if (['failed', 'cancelled'].includes(status?.status)) {
          setFeePaymentState(status.status);
        }
      } catch (error) {
        if (active)
          setFeePaymentError(
            error.message || 'Could not refresh payment status.',
          );
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [feePaymentId, feePaymentState, previewOnly, selectedChildId]);

  async function beginFeeCheckout() {
    if (
      !feeInvoice ||
      !selectedChildId ||
      !feeGateway?.enabled ||
      !feeGateway?.methods?.includes(feeMethod) ||
      previewOnly
    )
      return;
    setFeeCheckoutLoading(true);
    setFeePaymentError('');
    setFeePaymentState('creating');
    try {
      const invoiceId = String(feeInvoice.id || '');
      if (!invoiceId)
        throw new Error('This invoice is missing its server invoice ID.');
      const checkout = await parentApi.createFeeCheckout(
        selectedChildId,
        invoiceId,
        feeMethod,
      );
      const checkoutUrl =
        typeof checkout?.checkoutUrl === 'string'
          ? checkout.checkoutUrl.trim()
          : '';
      if (!/^https:\/\/[^/\s]+(?:[/?#]|$)/i.test(checkoutUrl)) {
        throw new Error(
          'The payment service did not return a secure checkout URL.',
        );
      }
      setFeePaymentId(String(checkout.paymentId || ''));
      setFeePaymentState('pending');
      await Linking.openURL(checkoutUrl);
    } catch (error) {
      setFeePaymentState('idle');
      setFeePaymentError(
        error.message || 'Secure checkout could not be started.',
      );
    } finally {
      setFeeCheckoutLoading(false);
    }
  }

  const selectedChild = children.find(child => child.id === selectedChildId);
  const visibleChildren =
    previewOnly && searchQuery.trim()
      ? children.filter(child =>
          JSON.stringify(child)
            .toLowerCase()
            .includes(searchQuery.trim().toLowerCase()),
        )
      : children;
  const visibleChildRecords = React.useMemo(() => {
    if (!previewOnly || !childRecords || !searchQuery.trim())
      return childRecords;
    const query = searchQuery.trim().toLowerCase();
    const matches = item => JSON.stringify(item).toLowerCase().includes(query);
    return {
      ...childRecords,
      attendance: childRecords.attendance.filter(matches),
      timetable: childRecords.timetable.filter(matches),
      homework: childRecords.homework.filter(matches),
      results: childRecords.results.filter(matches),
      progress: childRecords.progress.filter(matches),
      fees: childRecords.fees.filter(matches),
      feedback: {
        homework: childRecords.feedback.homework.filter(matches),
        results: childRecords.feedback.results.filter(matches),
        progress: childRecords.feedback.progress.filter(matches),
      },
    };
  }, [childRecords, previewOnly, searchQuery]);

  return (
    <KeyboardAvoidingView
      style={styles.keyboard}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          !previewOnly ? (
            <RefreshControl
              refreshing={childrenLoading || recordsLoading}
              onRefresh={() =>
                selectedChildId
                  ? loadChild(selectedChildId)
                  : loadChildren()
              }
              tintColor={colors.blue}
            />
          ) : undefined
        }
      >
        <Text style={styles.eyebrow}>FAMILY PORTAL</Text>
        <Text style={styles.heading}>
          {page === 'Fees'
            ? 'Fees & Payments'
            : page === 'Applications'
            ? 'Applications'
            : 'Parent dashboard'}
        </Text>
        {page === 'Applications' ? (
          <SchoolPageHero
            title="Your requests, organised"
            subtitle="Create an application and follow the class teacher's response."
            icon="file-pen"
          />
        ) : null}
        {page === 'Fees' ? (
          <SchoolPageHero
            title="Fees & Payments"
            subtitle="Check invoices, view receipts and choose secure checkout when available."
            icon="wallet"
          />
        ) : null}
        <Text style={styles.subtitle}>
          Only verified linked children are shown.
        </Text>
        {previewOnly ? (
          <Text style={styles.previewNotice}>
            Design preview · sample records
          </Text>
        ) : null}

        <View style={styles.headingRow}>
          <Text style={styles.sectionTitle}>Your children</Text>
          {!previewOnly ? (
            <Pressable accessibilityRole="button" onPress={loadChildren}>
              <Text style={styles.refresh}>Refresh</Text>
            </Pressable>
          ) : null}
        </View>
        {childrenLoading && children.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.blue} />
            <Text style={styles.muted}>Loading verified children…</Text>
          </View>
        ) : null}
        {childrenError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{childrenError}</Text>
            <Pressable accessibilityRole="button" onPress={loadChildren}>
              <Text style={styles.refresh}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {!childrenLoading && !childrenError && children.length === 0 ? (
          <Empty>No verified children are linked to this parent account.</Empty>
        ) : null}

        {page === 'Inbox' && (
          <>
            {' '}
            <View style={styles.headingRow}>
              <Text style={styles.sectionTitle}>
                {previewOnly
                  ? 'Preview notifications'
                  : `Parent DLP notifications · ${notificationUnreadCount} unread`}
              </Text>
              {!previewOnly ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={loadNotifications}
                >
                  <Text style={styles.refresh}>Refresh</Text>
                </Pressable>
              ) : null}
            </View>
            {notificationsLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.blue} />
                <Text style={styles.muted}>Loading notifications…</Text>
              </View>
            ) : null}
            {notificationsError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{notificationsError}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={loadNotifications}
                >
                  <Text style={styles.refresh}>Retry notifications</Text>
                </Pressable>
              </View>
            ) : null}
            {!notificationsLoading &&
            !notificationsError &&
            notifications.length === 0 ? (
              <Empty>No Parent DLP notifications are available.</Empty>
            ) : null}
            {notifications.map(item => (
              <Pressable
                key={item.id || item._id}
                accessibilityRole="button"
                disabled={!!dlpLoadingId}
                onPress={() => openDlp(item)}
                style={styles.childCard}
              >
                <Text style={styles.childName}>
                  {item.title || 'Parent DLP shared'}
                </Text>
                <Text style={styles.cardLine}>
                  {previewOnly
                    ? 'Fictional notification · preview only'
                    : `${
                        item.createdAt
                          ? new Date(item.createdAt).toLocaleString()
                          : ''
                      } · Open shared class version`}
                </Text>
                <Text style={styles.cardLine}>
                  {item.readAt ? 'Read' : 'Unread'}
                </Text>
                {dlpLoadingId === (item.id || String(item._id)) ? (
                  <ActivityIndicator color={colors.blue} />
                ) : null}
              </Pressable>
            ))}
            {dlpError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{dlpError}</Text>
              </View>
            ) : null}
            {openedDlp ? (
              <View style={styles.dataCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>
                    {openedDlp.dlpVersion.title ||
                      openedDlp.notification.title ||
                      'Parent DLP'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      notificationVersion.current += 1;
                      setOpenedDlp(null);
                    }}
                  >
                    <Text style={styles.refresh}>Close</Text>
                  </Pressable>
                </View>
                <Text style={styles.cardLine}>
                  Class:{' '}
                  {openedDlp.dlpVersion.className ||
                    openedDlp.dlpVersion.classId}{' '}
                  · Version:{' '}
                  {openedDlp.dlpVersion.version ||
                    openedDlp.dlpVersion.versionNumber ||
                    openedDlp.dlpVersion.id}
                </Text>
                {typeof openedDlp.dlpVersion.content === 'string' ? (
                  <Text style={styles.cardLine}>
                    {openedDlp.dlpVersion.content}
                  </Text>
                ) : null}
                {Array.isArray(openedDlp.dlpVersion.sections)
                  ? openedDlp.dlpVersion.sections.map((section, index) => (
                      <View key={section.id || index}>
                        <Text style={styles.childName}>
                          {section.title || section.heading}
                        </Text>
                        <Text style={styles.cardLine}>
                          {section.content || section.body || ''}
                        </Text>
                      </View>
                    ))
                  : null}
                {!openedDlp.dlpVersion.content &&
                !openedDlp.dlpVersion.sections?.length ? (
                  <Text style={styles.cardLine}>
                    The published version is loaded, but has no displayable
                    content fields.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        )}
        {visibleChildren.map(child => {
          const selected = child.id === selectedChildId;
          return (
            <Pressable
              key={child.id}
              testID={`parent-child-${child.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={childrenLoading}
              onPress={() => (selected ? null : loadChild(child.id))}
              style={[styles.childCard, selected && styles.selectedChild]}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.childName}>
                  {child.fullName || child.name || 'Child'}
                </Text>
                <Text style={[styles.status, selected && styles.selectedLabel]}>
                  {selected ? 'Selected' : 'View records'}
                </Text>
              </View>
              <Text style={styles.cardLine}>
                {[child.grade, child.section && `Section ${child.section}`]
                  .filter(Boolean)
                  .join(' · ') || 'Student record'}
              </Text>
            </Pressable>
          );
        })}

        {selectedChild ? (
          <>
            <View style={styles.headingRow}>
              <Text style={styles.sectionTitle}>
                {selectedChild.fullName || selectedChild.name || 'Selected child'}{' '}
                · records
              </Text>
              {!previewOnly ? (
                <Pressable
                  accessibilityRole="button"
                  testID="parent-refresh-selected-child"
                  disabled={recordsLoading}
                  onPress={() => loadChild(selectedChild.id)}
                >
                  <Text style={styles.refresh}>Refresh page</Text>
                </Pressable>
              ) : null}
            </View>
            {recordsLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.blue} />
                <Text style={styles.muted}>Loading this child’s records…</Text>
              </View>
            ) : null}
            {recordsError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{recordsError}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => loadChild(selectedChild.id)}
                >
                  <Text style={styles.refresh}>Retry selected child</Text>
                </Pressable>
              </View>
            ) : null}
            {!recordsLoading && childRecords ? (
              <>
                {Object.keys(recordErrors).length > 0 ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>
                      Some records could not be loaded.
                    </Text>
                    <Pressable onPress={() => loadChild(selectedChild.id)}>
                      <Text style={styles.refresh}>Retry failed sections</Text>
                    </Pressable>
                  </View>
                ) : null}
                {(page === 'My children' || page === 'All') ? (
                  recordErrors.profile ? (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{recordErrors.profile}</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => loadChild(selectedChild.id)}
                      >
                        <Text style={styles.refresh}>Retry profile</Text>
                      </Pressable>
                    </View>
                  ) : childRecords.profile ? (
                    <DataCard
                      title={
                        childRecords.profile.fullName ||
                        childRecords.profile.name ||
                        'Student profile'
                      }
                      lines={[
                        childRecords.profile.id && `Student ID: ${childRecords.profile.id}`,
                        childRecords.profile.grade,
                        childRecords.profile.section &&
                          `Section ${childRecords.profile.section}`,
                        childRecords.profile.status,
                      ].filter(Boolean)}
                    />
                  ) : (
                    <Empty>No profile is available for this child.</Empty>
                  )
                ) : null}
                <Section
                  activePage={page}
                  title="Attendance"
                  records={visibleChildRecords.attendance}
                  empty="No attendance records are available."
                  error={recordErrors.attendance}
                  onRetry={() => loadChild(selectedChild.id)}
                  render={item => (
                    <DataCard
                      key={item.id || item._id}
                      title={
                        item.date
                          ? new Date(item.date).toLocaleDateString()
                          : 'Attendance'
                      }
                      lines={[item.subject, item.note].filter(Boolean)}
                      status={item.status}
                    />
                  )}
                />
                <Section
                  activePage={page}
                  title="Timetable"
                  records={visibleChildRecords.timetable}
                  empty="No timetable entries are available."
                  error={recordErrors.timetable}
                  onRetry={() => loadChild(selectedChild.id)}
                  render={item => (
                    <DataCard
                      key={item.id || item._id}
                      title={item.subject || item.course || 'Class'}
                      lines={[
                        item.day || item.dayOfWeek,
                        [item.startTime, item.endTime]
                          .filter(Boolean)
                          .join(' – '),
                        item.room,
                        item.teacher,
                      ].filter(Boolean)}
                    />
                  )}
                />
                <Section
                  activePage={page}
                  title="Homework"
                  records={visibleChildRecords.homework}
                  empty="No published homework is assigned."
                  error={recordErrors.homework}
                  onRetry={() => loadChild(selectedChild.id)}
                  render={item => (
                    <DataCard
                      key={item.id || item._id}
                      title={item.title || item.subject || 'Homework'}
                      lines={[
                        item.description,
                        item.subject,
                        item.dueDate &&
                          `Due ${String(item.dueDate).slice(0, 10)}`,
                      ].filter(Boolean)}
                      status="Published"
                    />
                  )}
                />
                <Section
                  activePage={page}
                  title="Published results"
                  records={visibleChildRecords.results}
                  empty="No results have been published."
                  error={recordErrors.results}
                  onRetry={() => loadChild(selectedChild.id)}
                  render={item => (
                    <DataCard
                      key={item.id || item._id}
                      title={
                        item.examName || item.title || item.subject || 'Result'
                      }
                      lines={[
                        item.subject,
                        item.score != null && `Score: ${item.score}`,
                        item.grade && `Grade: ${item.grade}`,
                      ].filter(Boolean)}
                      feedback={item.teacherFeedback || item.feedback}
                    />
                  )}
                />
                <Section
                  activePage={page}
                  title="Progress"
                  records={visibleChildRecords.progress}
                  empty="No progress records have been published for this child."
                  error={recordErrors.progress}
                  onRetry={() => loadChild(selectedChild.id)}
                  render={item => (
                    <DataCard
                      key={item.id || item._id}
                      title={item.subject || item.area || item.title || 'Progress'}
                      lines={[
                        item.progress != null &&
                          `Progress: ${item.progress}${
                            typeof item.progress === 'number' ? '%' : ''
                          }`,
                        item.grade && `Grade: ${item.grade}`,
                        item.updatedAt &&
                          `Updated ${new Date(item.updatedAt).toLocaleDateString()}`,
                      ].filter(Boolean)}
                      feedback={item.teacherFeedback || item.feedback}
                    />
                  )}
                />
                {page === 'Fees' && !recordErrors.fees ? (
                  <View style={styles.balanceCard}>
                    <Text style={styles.balanceLabel}>Outstanding balance</Text>
                    <Text style={styles.balanceValue}>
                      {visibleChildRecords.fees.every(
                        invoice =>
                          invoice.balanceDue != null &&
                          Number.isFinite(Number(invoice.balanceDue)) &&
                          (invoice.currency || 'PKR') ===
                            (visibleChildRecords.fees[0]?.currency || 'PKR'),
                      ) ? money(
                        visibleChildRecords.fees.reduce(
                          (sum, invoice) =>
                            sum + Number(invoice.balanceDue || 0),
                          0,
                        ),
                        visibleChildRecords.fees[0]?.currency,
                      ) : 'Balance unavailable'}
                    </Text>
                    <Text style={styles.cardLine}>
                      {previewOnly
                        ? 'For the selected child · fictional preview balances'
                        : 'For the selected child · confirmed balances only'}
                    </Text>
                  </View>
                ) : null}
                <Section
                  activePage={page}
                  title="Fees"
                  records={visibleChildRecords.fees}
                  empty="No fee records are available."
                  error={recordErrors.fees}
                  onRetry={() => loadChild(selectedChild.id)}
                  render={item => (
                    <Pressable
                      key={item.id || item._id}
                      accessibilityRole="button"
                      accessibilityLabel={`View invoice ${
                        item.description || item.id || ''
                      }`}
                      onPress={() => {
                        setFeeInvoice(item);
                        setFeeFlowStep('invoice');
                        setFeeMethod('card');
                        setFeePaymentId('');
                        setFeePaymentState('idle');
                        setFeePaymentError('');
                        setFeePaymentReceipt(null);
                      }}
                      style={styles.dataCard}
                    >
                      <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>
                          {item.description ||
                            item.invoiceNumber ||
                            item.id ||
                            'Fee invoice'}
                        </Text>
                        <Text style={styles.status}>
                          {item.status || 'Invoice'}
                        </Text>
                      </View>
                      <Text style={styles.cardLine}>
                        Amount: {money(item.amount, item.currency)}
                      </Text>
                      <Text style={styles.cardLine}>
                        Confirmed paid:{' '}
                        {money(item.confirmedPaidAmount, item.currency)}
                      </Text>
                      <Text style={styles.cardLine}>
                        Pending verification (not paid):{' '}
                        {money(item.pendingAmount, item.currency)}
                      </Text>
                      <Text style={styles.cardLine}>
                        Due: {money(item.balanceDue, item.currency)}
                      </Text>
                      <Text style={styles.invoiceAction}>
                        Invoice details · Pay Fee ›
                      </Text>
                    </Pressable>
                  )}
                />
                {(page === 'Progress' ||
                  page === 'My children' ||
                  page === 'All') && (
                  <>
                    <Text style={styles.sectionTitle}>Teacher feedback</Text>
                    {recordErrors.feedback ? (
                      <View style={styles.errorBox}>
                        <Text style={styles.errorText}>
                          {recordErrors.feedback}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => loadChild(selectedChild.id)}
                        >
                          <Text style={styles.refresh}>Retry feedback</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {!recordErrors.feedback &&
                    visibleChildRecords.feedback.homework.length +
                      visibleChildRecords.feedback.results.length +
                      visibleChildRecords.feedback.progress.length ===
                      0 ? (
                      <Empty>No teacher feedback is available.</Empty>
                    ) : null}
                    {!recordErrors.feedback &&
                      visibleChildRecords.feedback.homework.map(item => (
                        <DataCard
                          key={`homework-${item.id || item._id}`}
                          title={
                            item.homework?.title ||
                            item.homeworkId ||
                            'Homework feedback'
                          }
                          lines={[
                            item.status,
                            item.submittedAt &&
                              `Submitted ${new Date(
                                item.submittedAt,
                              ).toLocaleDateString()}`,
                          ].filter(Boolean)}
                          feedback={item.teacherFeedback || item.feedback}
                        />
                      ))}
                    {!recordErrors.feedback &&
                      visibleChildRecords.feedback.results.map(item => (
                        <DataCard
                          key={`result-${item.id || item._id}`}
                          title={
                            item.examName ||
                            item.title ||
                            item.subject ||
                            'Result feedback'
                          }
                          feedback={item.teacherFeedback || item.feedback}
                        />
                      ))}
                    {!recordErrors.feedback &&
                      visibleChildRecords.feedback.progress.map(item => (
                        <DataCard
                          key={`progress-${item.id || item._id}`}
                          title={
                            item.subject || item.title || 'Progress feedback'
                          }
                          feedback={item.teacherFeedback || item.feedback}
                        />
                      ))}
                  </>
                )}
                {previewOnly && page === 'Applications' ? (
                  <View style={styles.dataCard}>
                    <Text style={styles.cardTitle}>Applications</Text>
                    <Text style={styles.cardLine}>
                      Sign in with a linked Parent account to send an
                      application to your child’s class teacher.
                    </Text>
                  </View>
                ) : null}
                {!previewOnly && (page === 'Applications' || page === 'All') ? (
                  <>
                    <Text style={styles.sectionTitle}>
                      Applications to class teacher
                    </Text>
                    <Text style={styles.muted}>
                      This application is routed by the selected child’s
                      verified class assignment.
                    </Text>
                    <Text style={styles.label}>Subject</Text>
                    <TextInput
                      accessibilityLabel="Application subject"
                      value={applicationTitle}
                      onChangeText={setApplicationTitle}
                      maxLength={APPLICATION_TITLE_LIMIT}
                      placeholder="Application subject"
                      style={styles.input}
                      placeholderTextColor={colors.muted}
                    />
                    <Text style={styles.label}>Message</Text>
                    <TextInput
                      accessibilityLabel="Application message"
                      value={applicationMessage}
                      onChangeText={setApplicationMessage}
                      maxLength={APPLICATION_MESSAGE_LIMIT}
                      placeholder="Write your application"
                      multiline
                      textAlignVertical="top"
                      style={[styles.input, styles.multiline]}
                      placeholderTextColor={colors.muted}
                    />
                    <Pressable
                      accessibilityRole="button"
                      disabled={applicationBusy || recordsLoading}
                      onPress={submitApplication}
                      style={styles.actionButton}
                    >
                      <Text style={styles.actionText}>
                        {applicationBusy ? 'Sending…' : 'Send application'}
                      </Text>
                    </Pressable>
                    {!!applicationNotice && (
                      <Text style={styles.successText}>
                        {applicationNotice}
                      </Text>
                    )}
                    {!!applicationError && (
                      <Text accessibilityRole="alert" style={styles.errorText}>
                        {applicationError}
                      </Text>
                    )}
                    <Section
                      activePage={page}
                      title="Application status history"
                      records={childRecords.applications}
                      empty="No applications have been sent for this child."
                      render={item => (
                        <View key={item.id || item._id} style={styles.dataCard}>
                          <View style={styles.cardHeader}>
                            <Text style={styles.cardTitle}>{item.title}</Text>
                            <Text style={styles.status}>
                              {String(item.status || '').replace(/_/g, ' ')}
                            </Text>
                          </View>
                          <Text style={styles.cardLine}>{item.message}</Text>
                          {(item.statusHistory || []).map((entry, index) => (
                            <Text
                              key={`${item.id || item._id}-${index}`}
                              style={styles.cardLine}
                            >
                              {String(entry.status || '').replace(/_/g, ' ')} ·{' '}
                              {entry.changedAt
                                ? new Date(entry.changedAt).toLocaleString()
                                : ''}
                              {entry.note ? ` · ${entry.note}` : ''}
                            </Text>
                          ))}
                        </View>
                      )}
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <Modal
        visible={!!feeInvoice}
        transparent
        animationType="fade"
        onRequestClose={() => setFeeInvoice(null)}
      >
        <View style={styles.paymentOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close invoice details"
            onPress={() => setFeeInvoice(null)}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.paymentSheet}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.paymentContent}
            >
              <View style={styles.cardHeader}>
                <View style={styles.grow}>
                  <Text style={styles.eyebrow}>
                    PARENT FEES · INVOICE DETAIL
                  </Text>
                  <Text style={styles.paymentTitle}>
                    {feeInvoice?.description ||
                      feeInvoice?.invoiceNumber ||
                      'Fee invoice'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close invoice details"
                  onPress={() => setFeeInvoice(null)}
                  style={styles.paymentClose}
                >
                  <Text style={styles.paymentCloseText}>×</Text>
                </Pressable>
              </View>
              <Text style={styles.paymentLine}>
                Invoice total ·{' '}
                {money(feeInvoice?.amount, feeInvoice?.currency)}
              </Text>
              <Text style={styles.paymentLine}>
                Confirmed paid ·{' '}
                {money(feeInvoice?.confirmedPaidAmount, feeInvoice?.currency)}
              </Text>
              <Text style={styles.paymentLine}>
                Pending verification ·{' '}
                {money(feeInvoice?.pendingAmount, feeInvoice?.currency)}
              </Text>
              <Text style={styles.paymentDue}>
                Balance due ·{' '}
                {money(feeInvoice?.balanceDue, feeInvoice?.currency)}
              </Text>
              {feeInvoice?.dueDate ? (
                <Text style={styles.muted}>
                  Due {String(feeInvoice.dueDate).slice(0, 10)}
                </Text>
              ) : null}

              {feeFlowStep === 'invoice' ? (
                <>
                  <Text style={styles.sectionTitle}>Payment history</Text>
                  {!asList(feeInvoice?.confirmedReceipts).length ? (
                    <Text style={styles.muted}>
                      No confirmed receipts for this invoice.
                    </Text>
                  ) : null}
                  {asList(feeInvoice?.confirmedReceipts).map(receipt => (
                    <View
                      key={receipt.paymentId || receipt.receiptNumber}
                      style={styles.receiptRow}
                    >
                      <Text style={styles.paymentMethodTitle}>
                        {receipt.receiptNumber || 'Confirmed receipt'}
                      </Text>
                      <Text style={styles.cardLine}>
                        {money(
                          receipt.amount,
                          receipt.currency || feeInvoice.currency,
                        )}{' '}
                        · {receipt.method || 'Payment'}
                      </Text>
                      <Text style={styles.muted}>
                        {receipt.confirmedAt
                          ? new Date(receipt.confirmedAt).toLocaleString()
                          : ''}
                      </Text>
                    </View>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    disabled={
                      Number(
                        feeInvoice?.availableBalance ??
                          feeInvoice?.balanceDue ??
                          0,
                      ) <= 0 ||
                      !feeGateway?.enabled ||
                      feeGatewayLoading ||
                      !!feeGatewayError
                    }
                    onPress={() => setFeeFlowStep('method')}
                    style={[
                      styles.actionButton,
                      Number(
                        feeInvoice?.availableBalance ??
                          feeInvoice?.balanceDue ??
                          0,
                      ) <= 0 ||
                      !feeGateway?.enabled ||
                      feeGatewayLoading ||
                      !!feeGatewayError
                        ? styles.paymentDisabled
                        : null,
                    ]}
                  >
                    <Text style={styles.actionText}>Pay Fee</Text>
                  </Pressable>
                </>
              ) : null}

              {feeFlowStep === 'method' ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setFeeFlowStep('invoice')}
                    style={styles.paymentBack}
                  >
                    <Text style={styles.refresh}>‹ Invoice details</Text>
                  </Pressable>
                  <Text style={styles.sectionTitle}>Choose payment method</Text>
                  {[
                    [
                      'card',
                      'Card',
                      'Debit or credit card through the merchant’s secure checkout',
                    ],
                    [
                      'easypaisa',
                      'Easypaisa',
                      'Pay using the Easypaisa merchant channel',
                    ],
                  ].map(([method, title, description]) => {
                    const methodEnabled =
                      feeGateway?.enabled &&
                      feeGateway?.methods?.includes(method);
                    return (
                    <Pressable
                      key={method}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: feeMethod === method,
                        disabled: previewOnly || !methodEnabled,
                      }}
                      disabled={previewOnly || !methodEnabled}
                      onPress={() => setFeeMethod(method)}
                      style={[
                        styles.paymentMethod,
                        feeMethod === method && styles.paymentMethodSelected,
                        (previewOnly || !methodEnabled) && styles.paymentDisabled,
                      ]}
                    >
                      <View style={styles.paymentRadio}>
                        {feeMethod === method ? (
                          <View style={styles.paymentRadioDot} />
                        ) : null}
                      </View>
                      <View style={styles.grow}>
                        <Text style={styles.paymentMethodTitle}>{title}</Text>
                        <Text style={styles.muted}>{description}</Text>
                        {!methodEnabled ? (
                          <Text style={styles.cardLine}>Not configured by the school merchant account</Text>
                        ) : null}
                      </View>
                    </Pressable>
                    );
                  })}

                  {feeGatewayLoading ? (
                    <ActivityIndicator color={colors.blue} />
                  ) : null}
                  {feeGatewayError ? (
                    <View accessibilityRole="alert" style={styles.errorBox}>
                      <Text style={styles.errorText}>{feeGatewayError}</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={loadFeeGateway}
                      >
                        <Text style={styles.refresh}>
                          Retry payment availability
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {!feeGatewayLoading &&
                  !feeGatewayError &&
                  !feeGateway?.enabled ? (
                    <View style={styles.gatewayUnavailable}>
                      <Text style={styles.paymentMethodTitle}>
                        Secure checkout isn’t configured
                      </Text>
                      <Text style={styles.cardLine}>
                        {feeGateway?.message ||
                          'The school has not connected a verified merchant checkout. No payment has been started.'}
                      </Text>
                      {previewOnly ? (
                        <Text style={styles.previewNotice}>
                          Developer Preview · payments are disabled.
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {feePaymentState === 'pending' ? (
                    <View style={styles.paymentStatus}>
                      <ActivityIndicator color={colors.blue} />
                      <Text style={styles.paymentMethodTitle}>
                        Checking payment status
                      </Text>
                      <Text style={styles.muted}>
                        The invoice changes only after the gateway confirms
                        payment.
                      </Text>
                    </View>
                  ) : null}
                  {feePaymentState === 'confirmed' ? (
                    <View style={styles.paymentReceipt}>
                      <Text style={styles.paymentMethodTitle}>
                        Payment confirmed
                      </Text>
                      {feePaymentReceipt?.receiptNumber ? (
                        <Text style={styles.cardLine}>
                          Receipt {feePaymentReceipt.receiptNumber}
                        </Text>
                      ) : null}
                      {feePaymentReceipt?.amount != null ? (
                        <Text style={styles.cardLine}>
                          {money(
                            feePaymentReceipt.amount,
                            feePaymentReceipt.currency || feeInvoice?.currency,
                          )}
                        </Text>
                      ) : null}
                      <Text style={styles.cardLine}>
                        {feePaymentReceipt?.confirmedAt
                          ? new Date(
                              feePaymentReceipt.confirmedAt,
                            ).toLocaleString()
                          : 'Confirmed by the payment service'}
                      </Text>
                    </View>
                  ) : null}
                  {['failed', 'cancelled'].includes(feePaymentState) ? (
                    <View accessibilityRole="alert" style={styles.errorBox}>
                      <Text style={styles.errorText}>
                        Gateway status: {feePaymentState}. The invoice remains
                        unpaid unless a verified status confirms payment.
                      </Text>
                    </View>
                  ) : null}
                  {feePaymentError ? (
                    <Text accessibilityRole="alert" style={styles.errorText}>
                      {feePaymentError}
                    </Text>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled:
                        !feeGateway?.enabled ||
                        feeGatewayLoading ||
                        feeCheckoutLoading ||
                        !feeGateway?.methods?.includes(feeMethod) ||
                        previewOnly,
                    }}
                    disabled={
                      !feeGateway?.enabled ||
                      feeGatewayLoading ||
                      feeCheckoutLoading ||
                      !feeGateway?.methods?.includes(feeMethod) ||
                      previewOnly
                    }
                    onPress={beginFeeCheckout}
                    style={[
                      styles.actionButton,
                      (!feeGateway?.enabled ||
                        feeGatewayLoading ||
                        feeCheckoutLoading ||
                        !feeGateway?.methods?.includes(feeMethod) ||
                        previewOnly) &&
                        styles.paymentDisabled,
                    ]}
                  >
                    {feeCheckoutLoading ? (
                      <ActivityIndicator color="#FFFEFA" />
                    ) : (
                      <Text style={styles.actionText}>Pay Fee securely</Text>
                    )}
                  </Pressable>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    padding: 22,
    borderRadius: 24,
    backgroundColor: '#FFE4AA',
    marginTop: 18,
  },
  balanceLabel: { color: '#6C5831', fontSize: 13, fontWeight: '700' },
  balanceValue: {
    color: '#282940',
    fontSize: 30,
    fontWeight: '900',
    marginTop: 9,
  },
  grow: { flex: 1 },
  keyboard: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.pale },
  content: { padding: 18, paddingBottom: 30 },
  eyebrow: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 12,
  },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 5 },
  headingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
  },
  refresh: { color: colors.blue, fontWeight: '800', fontSize: 12 },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 17,
  },
  muted: { color: colors.muted, fontSize: 12 },
  errorBox: {
    backgroundColor: '#FFF0EF',
    borderRadius: 18,
    padding: 13,
    marginVertical: 8,
  },
  errorText: { color: colors.red, fontSize: 12, lineHeight: 18 },
  empty: {
    color: colors.muted,
    backgroundColor: '#FFFEFA',
    borderRadius: 11,
    padding: 13,
    fontSize: 12,
    marginBottom: 7,
  },
  childCard: {
    backgroundColor: '#FFFEFA',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    marginBottom: 9,
  },
  selectedChild: { borderColor: colors.blue, borderWidth: 2 },
  selectedLabel: { color: colors.blue },
  childName: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  status: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  cardLine: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  dataCard: {
    backgroundColor: '#FFFEFA',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
  },
  invoiceAction: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 11,
  },
  paymentOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#28294088',
  },
  paymentSheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.pale,
    overflow: 'hidden',
  },
  paymentContent: { padding: 19, paddingBottom: 24 },
  paymentTitle: {
    color: colors.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
    marginTop: 7,
  },
  paymentClose: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFEFA',
    borderWidth: 1,
    borderColor: colors.line,
  },
  paymentCloseText: { color: colors.ink, fontSize: 24, lineHeight: 27 },
  paymentLine: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 5,
  },
  paymentDue: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '900',
    marginTop: 9,
  },
  paymentMethod: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    marginBottom: 9,
    backgroundColor: '#FFFEFA',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 15,
  },
  paymentMethodSelected: {
    borderColor: colors.blue,
    backgroundColor: '#EEEDFF',
  },
  paymentRadio: {
    width: 20,
    height: 20,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.blue,
  },
  paymentMethodTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  gatewayUnavailable: {
    padding: 13,
    marginVertical: 9,
    backgroundColor: '#FFF0CF',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#E9D6AD',
  },
  paymentStatus: {
    alignItems: 'center',
    gap: 8,
    padding: 14,
    marginVertical: 8,
    backgroundColor: '#FFFEFA',
    borderRadius: 15,
  },
  paymentReceipt: {
    padding: 13,
    marginVertical: 8,
    backgroundColor: '#E7F5EE',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#B8E0C8',
  },
  receiptRow: {
    padding: 12,
    marginTop: 7,
    backgroundColor: '#FFFEFA',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  paymentBack: { alignSelf: 'flex-start', paddingVertical: 9 },
  paymentDisabled: { opacity: 0.5 },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800', flex: 1 },
  feedback: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 9,
    paddingTop: 8,
  },
  feedbackLabel: { color: colors.blue, fontSize: 10, fontWeight: '800' },
  feedbackText: {
    color: colors.ink,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#FFFEFA',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 15,
    minHeight: 48,
    paddingHorizontal: 10,
    color: colors.ink,
    fontSize: 12,
    marginBottom: 10,
  },
  multiline: { minHeight: 100, paddingTop: 10 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
  },
  actionButton: {
    backgroundColor: colors.blue,
    minHeight: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 15,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  actionText: { color: '#FFFEFA', fontWeight: '800', fontSize: 12 },
  successText: { color: colors.green, fontSize: 12, marginVertical: 7 },
});
