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

export default function RecordedLessonsPage({ previewOnly = false, role = 'Teacher' }) {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  // Upload form
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [transcriptText, setTranscriptText] = useState('');

  // Teacher review overrides per lessonId
  const [reviewEdits, setReviewEdits] = useState({});

  const loadLessons = useCallback(async () => {
    if (previewOnly) {
      setLessons([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await authRequest('/recorded-lessons');
      setLessons(Array.isArray(response) ? response : response?.data || []);
    } catch (failure) {
      setError(failure.message || 'Unable to load recorded lessons.');
    } finally {
      setLoading(false);
    }
  }, [previewOnly]);

  useEffect(() => {
    loadLessons();
  }, [loadLessons]);

  async function uploadLesson() {
    if (previewOnly) return;
    setBusy('upload');
    setError('');
    setNotice('');
    try {
      const res = await authRequest('/recorded-lessons', {
        method: 'POST',
        body: JSON.stringify({
          title,
          subject,
          classId,
          section,
          transcriptText,
        }),
      });
      const created = res?.data || res;
      setLessons(current => [created, ...current]);
      setTitle('');
      setSubject('');
      setClassId('');
      setTranscriptText('');
      setNotice('Recorded lesson uploaded as unreviewed draft.');
    } catch (failure) {
      setError(failure.message || 'Could not upload recorded lesson.');
    } finally {
      setBusy('');
    }
  }

  async function processAiDraft(lessonId) {
    setBusy(`ai-${lessonId}`);
    setError('');
    setNotice('');
    try {
      await authRequest(`/recorded-lessons/${encodeURIComponent(lessonId)}/process-ai`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice('Server-side Gemini AI draft generated. Review and approve before publishing.');
      await loadLessons();
    } catch (failure) {
      setError(
        failure.message ||
          'AI draft generation is unavailable until server GEMINI_API_KEY is configured.',
      );
      await loadLessons();
    } finally {
      setBusy('');
    }
  }

  async function approveReview(lesson) {
    setBusy(`review-${lesson.id}`);
    setError('');
    setNotice('');
    const edit = reviewEdits[lesson.id] || {};
    const summary = edit.summary ?? lesson.aiDraft?.summary ?? lesson.summary ?? '';
    const revisionNotes =
      edit.revisionNotes ?? lesson.aiDraft?.revisionNotes ?? lesson.revisionNotes ?? '';
    const quizQuestions = lesson.aiDraft?.quizQuestions ?? [];
    try {
      await authRequest(`/recorded-lessons/${encodeURIComponent(lesson.id)}/review`, {
        method: 'POST',
        body: JSON.stringify({
          approved: true,
          summary,
          revisionNotes,
          quizQuestions,
        }),
      });
      setNotice('Teacher review & approval saved for current source version.');
      await loadLessons();
    } catch (failure) {
      setError(failure.message || 'Unable to save Teacher review.');
    } finally {
      setBusy('');
    }
  }

  async function publishLesson(lessonId) {
    setBusy(`publish-${lessonId}`);
    setError('');
    setNotice('');
    try {
      await authRequest(`/recorded-lessons/${encodeURIComponent(lessonId)}/publish`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice('Recorded lesson and approved revision materials published to eligible Students.');
      await loadLessons();
    } catch (failure) {
      setError(failure.message || 'Cannot publish before Teacher review on current source version.');
    } finally {
      setBusy('');
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>RECORDED LESSONS & AI REVISION WORKSPACE</Text>
      <Text style={styles.title}>Recorded Lessons & AI Draft Review</Text>
      <Text style={styles.subtitle}>
        Upload class recordings, generate server-side Gemini AI draft summaries and quizzes, review and edit as Teacher, and publish to eligible Students. Unreviewed AI output is never auto-published.
      </Text>

      {notice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {error ? (
        <View accessibilityRole="alert" style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!previewOnly && ['Teacher', 'Principal'].includes(role) ? (
        <View style={styles.card}>
          <Text style={styles.sectionHeading}>Upload Recorded Lesson</Text>
          <TextInput
            accessibilityLabel="Lesson Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Lesson Title (e.g. Cellular Respiration & ATP)"
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
              placeholder="Class ID (e.g. class-9)"
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
            accessibilityLabel="Lesson Transcript"
            value={transcriptText}
            onChangeText={setTranscriptText}
            placeholder="Lesson transcript or recording notes for AI draft generation"
            multiline
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy === 'upload'}
            onPress={uploadLesson}
            style={[styles.primaryBtn, busy === 'upload' && styles.disabled]}
          >
            <Text style={styles.primaryBtnText}>
              {busy === 'upload' ? 'Uploading…' : 'Upload Recorded Lesson'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={t.primary} />
          <Text style={styles.subtitle}>Loading recorded lessons…</Text>
        </View>
      ) : lessons.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.metaText}>
            {previewOnly
              ? 'Preview mode does not fabricate recorded lessons.'
              : 'No recorded lessons uploaded yet.'}
          </Text>
        </View>
      ) : (
        lessons.map(lesson => {
          const edit = reviewEdits[lesson.id] || {};
          const summaryVal =
            edit.summary ?? lesson.reviewedMaterial?.summary ?? lesson.aiDraft?.summary ?? '';
          const notesVal =
            edit.revisionNotes ??
            lesson.reviewedMaterial?.revisionNotes ??
            lesson.aiDraft?.revisionNotes ??
            '';
          return (
            <View key={lesson.id} style={styles.card}>
              <Text style={styles.cardTitle}>{lesson.title}</Text>
              <Text style={styles.metaText}>
                {lesson.subject} · {lesson.classId} ({lesson.section}) · Source v{lesson.sourceVersion} · Job: {lesson.jobStatus}
              </Text>
              <Text style={styles.metaText}>
                Teacher reviewed: {lesson.teacherReviewed ? 'Yes' : 'No'} · Published: {lesson.published ? 'Yes' : 'No'}
              </Text>
              {lesson.lastJobError ? (
                <Text style={styles.errorText}>{lesson.lastJobError}</Text>
              ) : null}

              <TextInput
                accessibilityLabel="Reviewed Summary"
                value={summaryVal}
                onChangeText={val =>
                  setReviewEdits(cur => ({
                    ...cur,
                    [lesson.id]: { ...cur[lesson.id], summary: val },
                  }))
                }
                placeholder="Teacher-reviewed lesson summary"
                multiline
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Reviewed Revision Notes"
                value={notesVal}
                onChangeText={val =>
                  setReviewEdits(cur => ({
                    ...cur,
                    [lesson.id]: { ...cur[lesson.id], revisionNotes: val },
                  }))
                }
                placeholder="Teacher-reviewed revision notes"
                multiline
                style={styles.input}
              />

              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!!busy}
                  onPress={() => processAiDraft(lesson.id)}
                  style={styles.secondaryBtn}
                >
                  <Text style={styles.secondaryBtnText}>
                    {busy === `ai-${lesson.id}` ? 'Processing AI…' : 'Generate AI Draft'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!!busy}
                  onPress={() => approveReview(lesson)}
                  style={styles.secondaryBtn}
                >
                  <Text style={styles.secondaryBtnText}>
                    {busy === `review-${lesson.id}` ? 'Approving…' : 'Approve Review'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!!busy}
                  onPress={() => publishLesson(lesson.id)}
                  style={styles.primaryBtnSmall}
                >
                  <Text style={styles.primaryBtnText}>
                    {busy === `publish-${lesson.id}` ? 'Publishing…' : 'Publish to Students'}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })
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
  cardTitle: { color: t.ink, fontSize: 16, fontWeight: '800' },
  metaText: { color: t.muted, fontSize: 12, marginTop: 4 },
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
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  noticeBox: { backgroundColor: '#CCFBF1', borderRadius: 14, padding: 12, marginTop: 12 },
  noticeText: { color: '#0F766E', fontSize: 13, fontWeight: '700' },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 14, padding: 12, marginTop: 12 },
  errorText: { color: '#B91C1C', fontSize: 13, marginTop: 4 },
  disabled: { opacity: 0.55 },
});
