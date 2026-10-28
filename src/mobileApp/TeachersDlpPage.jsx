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
import { authRequest } from './shared/services/authRequest';

export default function TeachersDlpPage({ previewOnly = false, role = 'Teacher' }) {
  const [dlps, setDlps] = useState([]);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  // DLP preparation form state
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [objectives, setObjectives] = useState('');
  const [activities, setActivities] = useState('');
  const [workCompletionStatus, setWorkCompletionStatus] = useState('completed');
  const [workCompletionDetails, setWorkCompletionDetails] = useState('');
  const [homeworkAssigned, setHomeworkAssigned] = useState('');
  const [internalStaffNotes, setInternalStaffNotes] = useState('');
  const [parentSummaryNotes, setParentSummaryNotes] = useState('');

  const loadDlps = useCallback(async () => {
    if (previewOnly) {
      setDlps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await authRequest('/dlp');
      setDlps(Array.isArray(response) ? response : response?.data || []);
    } catch (failure) {
      setError(failure.message || 'Could not load staff DLP directory.');
    } finally {
      setLoading(false);
    }
  }, [previewOnly]);

  useEffect(() => {
    loadDlps();
  }, [loadDlps]);

  async function createDlp() {
    if (previewOnly) return;
    setBusy('create');
    setError('');
    setNotice('');
    try {
      const created = await authRequest('/dlp', {
        method: 'POST',
        body: JSON.stringify({
          title,
          subject,
          classId,
          section,
          objectives,
          activities,
          workCompletionStatus,
          workCompletionDetails,
          homeworkAssigned,
          internalStaffNotes,
          parentSummaryNotes,
        }),
      });
      const record = created?.data || created;
      setDlps(current => [record, ...current]);
      setTitle('');
      setObjectives('');
      setActivities('');
      setWorkCompletionDetails('');
      setHomeworkAssigned('');
      setInternalStaffNotes('');
      setParentSummaryNotes('');
      setNotice('Daily Lesson Plan saved to staff directory.');
    } catch (failure) {
      setError(failure.message || 'Unable to save Daily Lesson Plan.');
    } finally {
      setBusy('');
    }
  }

  async function sendToPrincipal(dlpId) {
    setBusy(`principal-${dlpId}`);
    setError('');
    setNotice('');
    try {
      await authRequest(`/dlp/${encodeURIComponent(dlpId)}/send-principal`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice('DLP version sent to Principal for academic review.');
      await loadDlps();
    } catch (failure) {
      setError(failure.message || 'Unable to send DLP to Principal.');
    } finally {
      setBusy('');
    }
  }

  async function sendToParents(dlpId) {
    setBusy(`parents-${dlpId}`);
    setError('');
    setNotice('');
    try {
      await authRequest(`/dlp/${encodeURIComponent(dlpId)}/send-parents`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice('Parent-safe DLP version shared with class Parents via notifications.');
      await loadDlps();
    } catch (failure) {
      setError(failure.message || 'Unable to share DLP with Parents.');
    } finally {
      setBusy('');
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>STAFF-ONLY ACADEMIC DIRECTORY</Text>
      <Text style={styles.title}>Teachers DLP & Work Completion</Text>
      <Text style={styles.subtitle}>
        Prepare Daily Lesson Plans, record work-completion details, submit full versions to the Principal, and share audience-specific summaries with Parents.
      </Text>

      {notice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {error ? (
        <View accessibilityRole="alert" style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={loadDlps} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {!previewOnly && ['Teacher', 'Principal'].includes(role) ? (
        <View style={styles.card}>
          <Text style={styles.sectionHeading}>Prepare Daily Lesson Plan</Text>
          <TextInput
            accessibilityLabel="DLP Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Lesson title (e.g. Quadratic Equations & Graphs)"
            style={styles.input}
          />
          <View style={styles.rowInputs}>
            <TextInput
              accessibilityLabel="Subject"
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject"
              style={[styles.input, styles.halfInput]}
            />
            <TextInput
              accessibilityLabel="Class ID"
              value={classId}
              onChangeText={setClassId}
              placeholder="Class (e.g. Grade 9)"
              style={[styles.input, styles.halfInput]}
            />
            <TextInput
              accessibilityLabel="Section"
              value={section}
              onChangeText={setSection}
              placeholder="Section (required)"
              style={[styles.input, styles.halfInput]}
            />
          </View>
          <TextInput
            accessibilityLabel="Learning Objectives"
            value={objectives}
            onChangeText={setObjectives}
            placeholder="Learning objectives"
            multiline
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Classroom Activities"
            value={activities}
            onChangeText={setActivities}
            placeholder="Classroom activities & methodology"
            multiline
            style={styles.input}
          />
          <View style={styles.statusRow}>
            {['completed', 'partially_completed', 'rescheduled'].map(st => (
              <Pressable
                key={st}
                accessibilityRole="button"
                onPress={() => setWorkCompletionStatus(st)}
                style={[
                  styles.chip,
                  workCompletionStatus === st && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    workCompletionStatus === st && styles.chipTextActive,
                  ]}
                >
                  {st.replace(/_/g, ' ')}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Work Completion Details"
            value={workCompletionDetails}
            onChangeText={setWorkCompletionDetails}
            placeholder="Work-completion details (exercises covered, mastery notes)"
            multiline
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Internal Staff Notes"
            value={internalStaffNotes}
            onChangeText={setInternalStaffNotes}
            placeholder="Internal staff notes (visible to Principal & staff only)"
            multiline
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Parent Summary Notes"
            value={parentSummaryNotes}
            onChangeText={setParentSummaryNotes}
            placeholder="Parent-facing version summary (shared when sent to Parents)"
            multiline
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy === 'create'}
            onPress={createDlp}
            style={[styles.primaryBtn, busy === 'create' && styles.disabled]}
          >
            <Text style={styles.primaryBtnText}>
              {busy === 'create' ? 'Saving DLP…' : 'Save DLP Record'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.directoryHeader}>
        <Text style={styles.sectionHeading}>Staff DLP Directory</Text>
        <Pressable accessibilityRole="button" onPress={loadDlps}>
          <Text style={styles.refreshLink}>Refresh</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={t.primary} />
          <Text style={styles.subtitle}>Loading staff DLP records…</Text>
        </View>
      ) : dlps.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No teacher DLP records available</Text>
          <Text style={styles.emptyText}>
            {previewOnly
              ? 'Preview mode does not create fictional teacher records.'
              : 'Prepare a Daily Lesson Plan above to share with the Principal or class Parents.'}
          </Text>
        </View>
      ) : (
        dlps.map(item => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.metaText}>
              {item.subject} · {item.classId} ({item.section}) · v{item.versionNumber || 1} · {item.workCompletionStatus?.replace(/_/g, ' ')}
            </Text>
            <Text style={styles.bodyText}>{item.workCompletionDetails}</Text>
            {item.internalStaffNotes ? (
              <Text style={styles.staffNote}>Staff note: {item.internalStaffNotes}</Text>
            ) : null}
            <Text style={styles.metaText}>
              Principal status: {item.principalReviewStatus || 'not_sent'} · Parent status: {item.parentShareStatus || 'not_shared'}
            </Text>
            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => sendToPrincipal(item.id)}
                style={[styles.secondaryBtn, busy === `principal-${item.id}` && styles.disabled]}
              >
                <Text style={styles.secondaryBtnText}>
                  {busy === `principal-${item.id}` ? 'Sending…' : 'Send to Principal'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => sendToParents(item.id)}
                style={[styles.primaryBtnSmall, busy === `parents-${item.id}` && styles.disabled]}
              >
                <Text style={styles.primaryBtnText}>
                  {busy === `parents-${item.id}` ? 'Sharing…' : 'Send to Parents'}
                </Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: t.background },
  content: { padding: 20, paddingBottom: 36 },
  eyebrow: { color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { color: t.ink, fontSize: 26, fontWeight: '800', marginTop: 6 },
  subtitle: { color: t.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  card: {
    backgroundColor: t.paper,
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginTop: 16,
    ...t.shadow,
  },
  sectionHeading: { color: t.ink, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  input: {
    backgroundColor: t.mutedContainer || '#F5F2EB',
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: t.ink,
    marginTop: 10,
    fontSize: 13,
  },
  rowInputs: { flexDirection: 'row', gap: 10 },
  halfInput: { flex: 1 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: t.paper,
  },
  chipActive: { backgroundColor: t.primary, borderColor: t.primary },
  chipText: { color: t.muted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  primaryBtn: {
    backgroundColor: t.primary,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryBtnSmall: {
    backgroundColor: t.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  secondaryBtn: {
    borderColor: t.secondary || '#1E3A8A',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
    backgroundColor: t.paper,
  },
  secondaryBtnText: { color: t.secondary || '#1E3A8A', fontWeight: '700', fontSize: 13 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  directoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 22,
  },
  refreshLink: { color: t.primary, fontWeight: '700', fontSize: 13 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  empty: {
    backgroundColor: t.paper,
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginTop: 16,
    ...t.shadow,
  },
  emptyTitle: { color: t.ink, fontSize: 16, fontWeight: '800' },
  emptyText: { color: t.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  cardTitle: { color: t.ink, fontSize: 16, fontWeight: '800' },
  metaText: { color: t.muted, fontSize: 12, marginTop: 4 },
  bodyText: { color: t.ink, fontSize: 13, lineHeight: 19, marginTop: 8 },
  staffNote: { color: t.secondary || '#1E3A8A', fontSize: 12, marginTop: 6, fontWeight: '600' },
  noticeBox: {
    backgroundColor: '#CCFBF1',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },
  noticeText: { color: '#0F766E', fontSize: 13, fontWeight: '700' },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },
  errorText: { color: '#B91C1C', fontSize: 13 },
  retryBtn: { marginTop: 8 },
  retryText: { color: t.primary, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
