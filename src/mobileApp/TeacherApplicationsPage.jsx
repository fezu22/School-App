import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme as t } from './theme/hiraTheme';
import { applicationReviewApi } from './shared/services/applicationReviewService';

export default function TeacherApplicationsPage() {
  const [items, setItems] = useState([]);
  const [principalItems, setPrincipalItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({});
  const [principalTitle, setPrincipalTitle] = useState('');
  const [principalMessage, setPrincipalMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [assigned, ownPrincipal] = await Promise.all([
        applicationReviewApi.list(),
        applicationReviewApi.listPrincipalApplications ? applicationReviewApi.listPrincipalApplications().catch(() => []) : Promise.resolve([]),
      ]);
      setItems(Array.isArray(assigned) ? assigned : []);
      setPrincipalItems(Array.isArray(ownPrincipal) ? ownPrincipal : []);
    } catch (failure) {
      setError(failure.message || 'Could not load assigned applications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(item, status) {
    setBusy(item.id);
    setError('');
    setNotice('');
    try {
      const updated = await applicationReviewApi.review(item.id, status, notes[item.id] || '');
      setItems(current => current.map(entry => (entry.id === item.id ? updated : entry)));
      setNotes(current => ({ ...current, [item.id]: '' }));
      if (updated.notificationWarning) setNotice(updated.notificationWarning);
    } catch (failure) {
      setError(failure.message || 'Could not update application status.');
    } finally {
      setBusy('');
    }
  }

  async function submitToPrincipal() {
    if (!principalTitle.trim() || !principalMessage.trim()) {
      setError('Enter both an application title and message for the Principal.');
      return;
    }
    setBusy('submit-principal');
    setError('');
    setNotice('');
    try {
      const created = await applicationReviewApi.submitToPrincipal({
        title: principalTitle.trim(),
        category: 'teacher_application',
        message: principalMessage.trim(),
      });
      setPrincipalItems(current => [created, ...current]);
      setPrincipalTitle('');
      setPrincipalMessage('');
      setNotice('Your application has been routed to the Principal.');
    } catch (failure) {
      setError(failure.message || 'Could not submit application to Principal.');
    } finally {
      setBusy('');
    }
  }

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>TEACHER WORKSPACE</Text>
      <Text style={s.title}>Applications & Principal Routing</Text>
      <Pressable accessibilityRole="button" onPress={load} style={s.refresh}>
        <Text style={s.refreshText}>Refresh</Text>
      </Pressable>
      {notice ? <Text style={s.muted}>{notice}</Text> : null}
      {loading ? (
        <View style={s.row}>
          <ActivityIndicator color={t.primary} />
          <Text style={s.muted}>Loading assigned applications…</Text>
        </View>
      ) : null}
      {error ? (
        <View style={s.error}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={load}>
            <Text style={s.refreshText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.cardTitle}>Submit Application to Principal</Text>
        <Text style={s.muted}>Route leave, timetable, or academic requests directly to your campus Principal.</Text>
        <TextInput
          accessibilityLabel="Principal application title"
          value={principalTitle}
          onChangeText={setPrincipalTitle}
          placeholder="Subject / Title"
          style={s.input}
        />
        <TextInput
          accessibilityLabel="Principal application message"
          value={principalMessage}
          onChangeText={setPrincipalMessage}
          placeholder="Details for Principal review"
          multiline
          style={s.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!!busy}
          onPress={submitToPrincipal}
          style={[s.button, { alignSelf: 'flex-start', marginTop: 10 }, busy === 'submit-principal' && s.disabled]}
        >
          <Text style={s.buttonText}>{busy === 'submit-principal' ? 'Sending…' : 'Send to Principal'}</Text>
        </Pressable>
      </View>

      {principalItems.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <Text style={s.cardTitle}>My Applications to Principal</Text>
          {principalItems.map(item => (
            <View key={item.id} style={s.card}>
              <Text style={s.cardTitle}>{item.title}</Text>
              <Text style={s.muted}>Routed to Principal · {item.status?.replace(/_/g, ' ')}</Text>
              <Text style={s.body}>{item.message}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={[s.cardTitle, { marginTop: 18 }]}>Assigned Student & Parent Applications</Text>
      {!loading && !error && items.length === 0 ? (
        <Text style={s.empty}>No applications are assigned to your teacher account.</Text>
      ) : null}
      {items.map(item => (
        <View key={item.id} style={s.card}>
          <Text style={s.cardTitle}>{item.title}</Text>
          <Text style={s.muted}>
            Student {item.studentId} · {item.status?.replace(/_/g, ' ')}
          </Text>
          <Text style={s.body}>{item.message}</Text>
          {(item.statusHistory || []).map((event, index) => (
            <Text key={`${item.id}-${index}`} style={s.muted}>
              {event.status?.replace(/_/g, ' ')} ·{' '}
              {event.changedAt ? new Date(event.changedAt).toLocaleString() : ''}
              {event.note ? ` · ${event.note}` : ''}
            </Text>
          ))}
          {['submitted', 'needs_information'].includes(item.status) ? (
            <>
              <TextInput
                accessibilityLabel="Review note"
                value={notes[item.id] || ''}
                onChangeText={value => setNotes(current => ({ ...current, [item.id]: value }))}
                placeholder="Optional note to applicant"
                multiline
                style={s.input}
              />
              <View style={s.actions}>
                {[
                  ['approved', 'Approve'],
                  ['rejected', 'Reject'],
                  ['needs_information', 'Request information'],
                ].map(([status, label]) => (
                  <Pressable
                    key={status}
                    accessibilityRole="button"
                    disabled={!!busy}
                    onPress={() => review(item, status)}
                    style={[s.button, busy === item.id && s.disabled]}
                  >
                    <Text style={s.buttonText}>{busy === item.id ? 'Saving…' : label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: t.background },
  content: { padding: 18, paddingBottom: 30 },
  eyebrow: { color: t.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: t.ink, fontSize: 27, fontWeight: '900', marginTop: 8 },
  refresh: { alignSelf: 'flex-start', paddingVertical: 12 },
  refreshText: { color: t.primary, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 18 },
  muted: { color: t.muted, fontSize: 12, marginTop: 5 },
  error: { padding: 14, borderRadius: 14, backgroundColor: '#FEE2E2' },
  errorText: { color: '#B91C1C', marginBottom: 8 },
  empty: { padding: 14, marginTop: 14, borderRadius: 12, backgroundColor: t.paper, color: t.muted },
  card: {
    padding: 16,
    marginTop: 12,
    borderRadius: 20,
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
    ...t.shadow,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: t.ink },
  body: { color: t.ink, fontSize: 13, lineHeight: 19, marginVertical: 10 },
  input: {
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 44,
    padding: 11,
    color: t.ink,
    marginTop: 10,
    backgroundColor: t.mutedContainer || '#F5F2EB',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  button: { backgroundColor: t.primary, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999 },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 12 },
  disabled: { opacity: 0.55 },
});
