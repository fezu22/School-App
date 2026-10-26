import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { financeApi } from '../../roles/finance/financeService';
import { parentApi } from '../../roles/parent/parentService';
import { studentApi } from '../../roles/student/studentService';
import { theme as t } from '../../theme/hiraTheme';

const apiByRole = { Student: studentApi, Parent: parentApi, Finance: financeApi };
const notificationId = item => item.id || String(item._id || '');

function DlpDetails({ version }) {
  return (
    <View style={styles.dlp}>
      <Text style={styles.dlpTitle}>{version.title || 'Shared DLP'}</Text>
      <Text style={styles.meta}>
        Class {version.className || version.classId} · Version{' '}
        {version.version || version.versionNumber || version.id}
      </Text>
      {typeof version.content === 'string' ? (
        <Text style={styles.body}>{version.content}</Text>
      ) : null}
      {Array.isArray(version.sections)
        ? version.sections.map((section, index) => (
            <View key={section.id || index} style={styles.section}>
              {section.title || section.heading ? (
                <Text style={styles.itemTitle}>
                  {section.title || section.heading}
                </Text>
              ) : null}
              <Text style={styles.body}>
                {String(section.content || section.body || '')}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

export default function InboxNotifications({ role, previewOnly }) {
  const api = apiByRole[role];
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(!!api && !previewOnly);
  const [openingId, setOpeningId] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const version = useRef(0);

  const load = useCallback(async () => {
    if (!api || previewOnly) return;
    const request = ++version.current;
    setLoading(true);
    setError('');
    try {
      const result = await api.getNotifications();
      if (request !== version.current) return;
      setItems(Array.isArray(result?.notifications) ? result.notifications : []);
      setUnreadCount(Number(result?.unreadCount) || 0);
    } catch (failure) {
      if (request === version.current)
        setError(failure.message || 'Could not load notifications.');
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [api, previewOnly]);

  useEffect(() => {
    load();
    return () => {
      version.current += 1;
    };
  }, [load]);

  async function open(item) {
    const id = notificationId(item);
    if (!id || !api) return;
    const request = ++version.current;
    setOpeningId(id);
    setError('');
    try {
      await api.markNotificationRead(id);
      const detail = await api.getNotification(id);
      if (request !== version.current) return;
      setSelected(detail?.notification ? detail : { notification: detail });
      if (!item.readAt) {
        setUnreadCount(current => Math.max(0, current - 1));
        setItems(current =>
          current.map(entry =>
            notificationId(entry) === id
              ? { ...entry, readAt: new Date().toISOString() }
              : entry,
          ),
        );
      }
    } catch (failure) {
      if (request === version.current)
        setError(failure.message || 'Could not open this notification.');
    } finally {
      if (request === version.current) setOpeningId('');
    }
  }

  if (previewOnly) return null;
  if (!api) {
    return (
      <View style={styles.notice}>
        <Text style={styles.itemTitle}>Notifications unavailable</Text>
        <Text style={styles.body}>
          This staff role has no authenticated notification API connected.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.meta}>{unreadCount} unread</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={load}>
          <Text style={styles.refresh}>Refresh</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color={t.primary} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!loading && !error && !items.length ? (
        <Text style={styles.empty}>No notifications yet.</Text>
      ) : null}
      {selected ? (
        <View style={styles.detail}>
          <Pressable accessibilityRole="button" onPress={() => setSelected(null)}>
            <Text style={styles.refresh}>‹ All notifications</Text>
          </Pressable>
          <Text style={styles.dlpTitle}>{selected.notification?.title || 'Notification'}</Text>
          <Text style={styles.body}>{selected.notification?.body || selected.notification?.message || ''}</Text>
          {selected.dlpVersion ? <DlpDetails version={selected.dlpVersion} /> : null}
        </View>
      ) : (
        items.map(item => {
          const id = notificationId(item);
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              disabled={!!openingId}
              onPress={() => open(item)}
              style={styles.item}
            >
              <View style={[styles.dot, item.readAt && styles.readDot]} />
              <View style={styles.copy}>
                <Text style={styles.itemTitle}>{item.title || 'Notification'}</Text>
                <Text numberOfLines={2} style={styles.body}>
                  {item.body || item.message || (item.type === 'parent_dlp_shared' ? 'A DLP version was shared for your child’s class.' : 'Open notification')}
                </Text>
                <Text style={styles.meta}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</Text>
              </View>
              {openingId === id ? <ActivityIndicator color={t.primary} /> : null}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 20 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: t.ink, fontSize: 19, fontWeight: '900' },
  meta: { color: t.muted, fontSize: 11, marginTop: 4 },
  refresh: { color: t.primary, fontWeight: '800', paddingVertical: 8 },
  error: { color: '#B42318', marginVertical: 10 },
  empty: { color: t.muted, padding: 18, backgroundColor: t.paper, borderRadius: 16 },
  item: { flexDirection: 'row', gap: 10, padding: 14, marginBottom: 8, backgroundColor: t.paper, borderWidth: 1, borderColor: t.border, borderRadius: 16 },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 5, backgroundColor: t.primary },
  readDot: { backgroundColor: t.border },
  copy: { flex: 1 },
  itemTitle: { color: t.ink, fontSize: 14, fontWeight: '800' },
  body: { color: t.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  detail: { padding: 16, backgroundColor: t.paper, borderRadius: 18, borderWidth: 1, borderColor: t.border },
  dlp: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.border },
  dlpTitle: { color: t.ink, fontSize: 17, fontWeight: '900', marginTop: 8 },
  section: { marginTop: 10 },
  notice: { padding: 16, marginBottom: 18, backgroundColor: t.paper, borderRadius: 16, borderWidth: 1, borderColor: t.border },
});
