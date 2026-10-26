import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { parentApi } from '../../roles/parent/parentService';
import { studentApi } from '../../roles/student/studentService';
import { financeApi } from '../../roles/finance/financeService';
import {
  getPreviewNotifications,
  markPreviewNotificationsRead,
  subscribePreviewNotifications,
} from '../data/referenceNotificationPreview';
import {
  SchoolPanel,
  schoolColors as c,
  schoolStyles as s,
} from '../components/SchoolReferenceUI';

const apis = { Parent: parentApi, Student: studentApi, Finance: financeApi };
const idOf = item => String(item?.id || item?._id || '');
const needsAction = item =>
  item.needsAction === true ||
  item.requiresAction === true ||
  item.actionRequired === true;
function Content({ value }) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number')
    return <Text style={s.subtitle}>{String(value)}</Text>;
  if (Array.isArray(value))
    return value.map((item, index) => (
      <View key={index}>
        <Text style={styles.detailHeading}>
          {item.title || item.heading || ''}
        </Text>
        <Content value={item.content || item.body || item} />
      </View>
    ));
  return Object.entries(value)
    .filter(
      ([key, item]) =>
        !['_id', 'fileData', 'recipientUserId', 'parentUserId'].includes(key) &&
        item != null &&
        typeof item !== 'object',
    )
    .map(([key, item]) => (
      <Text key={key} style={s.subtitle}>
        {key.replace(/([A-Z])/g, ' $1')}: {String(item)}
      </Text>
    ));
}
export default function ReferenceNotifications({ role, previewOnly = false, refreshKey }) {
  const api = apis[role];
  const [items, setItems] = useState(
    previewOnly ? getPreviewNotifications(role) : [],
  );
  useEffect(() => {
    if (!previewOnly) return;
    setItems(getPreviewNotifications(role));
    return subscribePreviewNotifications(role, setItems);
  }, [previewOnly, role]);
  const [filter, setFilter] = useState('All'),
    [selected, setSelected] = useState(null),
    [loading, setLoading] = useState(!previewOnly);
  const [opening, setOpening] = useState(''),
    [error, setError] = useState('');
  const version = useRef(0);
  const load = useCallback(async () => {
    if (previewOnly) return;
    const request = ++version.current;
    setLoading(true);
    setError('');
    setOpening('');
    setSelected(null);
    try {
      if (!api)
        throw new Error(
          'No authorized notification API is connected for this role.',
        );
      const response = await api.getNotifications();
      if (request === version.current)
        setItems(
          Array.isArray(response?.notifications) ? response.notifications : [],
        );
    } catch (failure) {
      if (request === version.current) {
        setItems([]);
        setError(failure.message || 'Could not load notifications.');
      }
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [api, previewOnly]);
  useEffect(() => {
    load();
    return () => {
      version.current += 1;
    };
  }, [load, refreshKey]);
  const unread = items.filter(item => !item.readAt).length;
  const markLocal = ids => {
    if (previewOnly) {
      setItems(markPreviewNotificationsRead(role, ids));
      return;
    }
    setItems(current =>
      current.map(item =>
        ids.includes(idOf(item))
          ? { ...item, readAt: item.readAt || new Date().toISOString() }
          : item,
      ),
    );
  };
  async function open(item) {
    const id = idOf(item);
    if (!id || opening) return;
    const request = ++version.current;
    setOpening(id);
    setError('');
    try {
      if (previewOnly) {
        markLocal([id]);
        setSelected({ notification: item, dlpVersion: item.previewDlpVersion });
        return;
      }
      await api.markNotificationRead(id);
      if (request !== version.current) return;
      markLocal([id]);
      const response = await api.getNotification(id);
      if (request === version.current)
        setSelected(
          response?.notification ? response : { notification: response },
        );
    } catch (failure) {
      if (request === version.current)
        setError(failure.message || 'Could not open notification.');
    } finally {
      if (request === version.current) setOpening('');
    }
  }
  async function markAll() {
    const ids = items
      .filter(item => !item.readAt)
      .map(idOf)
      .filter(Boolean);
    if (!ids.length || opening) return;
    if (previewOnly) {
      markLocal(ids);
      return;
    }
    const request = ++version.current;
    setOpening('all');
    setError('');
    try {
      const results = await Promise.allSettled(
        ids.map(id => api.markNotificationRead(id)),
      );
      if (request !== version.current) return;
      markLocal(
        ids.filter((_, index) => results[index].status === 'fulfilled'),
      );
      if (results.some(item => item.status === 'rejected'))
        setError(
          'Some notifications could not be marked read. Retry those records.',
        );
    } finally {
      if (request === version.current) setOpening('');
    }
  }
  const visible = items.filter(
    item =>
      filter === 'All' ||
      (filter === 'Unread' ? !item.readAt : needsAction(item)),
  );
  const detail =
    selected?.dlpVersion || selected?.record || selected?.notification;
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={load}
          tintColor={c.primary}
        />
      }
    >
      <View style={styles.heading}>
        <View style={styles.flex}>
          <Text style={s.title}>Notifications</Text>
          <Text style={s.subtitle}>Your received work and school updates</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications read"
          disabled={!unread || !!opening || loading}
          onPress={markAll}
          style={styles.markButton}
        >
          <View style={styles.markIcon}>
            <Image source={require('../../assets/mark.png')} style={styles.markImage} resizeMode="contain" />
          </View>
          <Text style={styles.markText}>Mark all read</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color={c.primary} /> : null}
      {error ? (
        <SchoolPanel>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Pressable accessibilityRole="button" onPress={load}>
            <Text style={styles.link}>Refresh</Text>
          </Pressable>
        </SchoolPanel>
      ) : null}
      {selected ? (
        <SchoolPanel>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to notifications"
            onPress={() => setSelected(null)}
          >
            <Text style={styles.link}>‹ All notifications</Text>
          </Pressable>
          <Text style={styles.detailHeading}>
            {detail?.title || selected.notification?.title || 'Notification'}
          </Text>
          <Text style={s.subtitle}>
            {selected.notification?.body ||
              selected.notification?.message ||
              ''}
          </Text>
          {selected.dlpVersion ? (
            <Text style={s.subtitle}>
              Class {detail.className || detail.classId} · Version{' '}
              {detail.version || detail.versionNumber || detail.id}
            </Text>
          ) : null}
          <Content
            value={
              detail?.sections ||
              detail?.content ||
              (selected.dlpVersion ? detail : selected.record)
            }
          />
        </SchoolPanel>
      ) : (
        <>
          <View style={styles.tabs}>
            {['All', 'Unread', 'Needs action'].map(value => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === value }}
                onPress={() => setFilter(value)}
                style={[styles.tab, filter === value && styles.activeTab]}
              >
                <Text
                  style={[
                    styles.tabText,
                    filter === value && styles.activeText,
                  ]}
                >
                  {value === 'Unread' ? `Unread (${unread})` : value}
                </Text>
              </Pressable>
            ))}
          </View>
          <SchoolPanel title="Inbox">
            {!loading && !error && !visible.length ? (
              <Text style={s.subtitle}>
                No notifications for this selection.
              </Text>
            ) : null}
            {visible.map(item => (
              <Pressable
                key={idOf(item)}
                accessibilityRole="button"
                accessibilityLabel={`Open notification: ${
                  item.title || 'School update'
                }`}
                disabled={!!opening}
                onPress={() => open(item)}
                style={[styles.notice, item.readAt && styles.readNotice]}
              >
                <Text style={styles.icon}>
                  {needsAction(item) ? '📥' : '🔔'}
                </Text>
                <View style={styles.flex}>
                  <Text style={styles.noticeTitle}>
                    {item.title || 'School update'}
                  </Text>
                  <Text style={styles.noticeText}>
                    {item.body || item.message || 'Open school notification'}
                  </Text>
                  {needsAction(item) ? (
                    <View style={styles.actionBadge}>
                      <Text style={styles.actionText}>Needs action</Text>
                    </View>
                  ) : null}
                </View>
                {!item.readAt ? <Text style={styles.unreadDot}>•</Text> : null}
                {opening === idOf(item) ? (
                  <ActivityIndicator color={c.primary} />
                ) : null}
              </Pressable>
            ))}
          </SchoolPanel>
        </>
      )}
      {previewOnly ? (
        <Text style={s.preview}>
          Development design preview · notifications are local only
        </Text>
      ) : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  markButton: {
    minHeight: 46,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: c.primary,
    borderRadius: 23,
    backgroundColor: c.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  markIcon: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markImage: { width: 16, height: 16 },
  markText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  tabs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: '#FFFEFA',
  },
  activeTab: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { fontSize: 12, color: c.primary, fontWeight: '700' },
  activeText: { color: '#fff' },
  notice: {
    backgroundColor: '#F0F1FF',
    borderRadius: 13,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 2,
    minHeight: 98,
  },
  readNotice: { backgroundColor: '#F8F8F4' },
  icon: { fontSize: 23 },
  noticeTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.ink,
    lineHeight: 21,
  },
  noticeText: { fontSize: 13, color: c.muted, lineHeight: 20, marginTop: 5 },
  unreadDot: { fontSize: 18, color: c.primary },
  actionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF0CA',
    padding: 7,
    borderRadius: 7,
    marginTop: 8,
  },
  actionText: { fontSize: 11, fontWeight: '800', color: '#AD7B1E' },
  link: {
    fontSize: 13,
    fontWeight: '800',
    color: c.primary,
    paddingVertical: 12,
  },
  detailHeading: {
    fontSize: 19,
    fontWeight: '800',
    color: c.ink,
    marginTop: 10,
  },
  error: { fontSize: 13, color: '#B42318', lineHeight: 20 },
});
