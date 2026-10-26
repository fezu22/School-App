import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import {
  Button,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import {
  teacherService,
  type TeacherTupleIds,
} from '../../services/teacher/teacherService';
import {
  communicationService,
  noticeOperationId,
  type NoticeContent,
  type TeacherNotice,
  type RecipientPreview,
} from '../../services/teacher/communicationService';
import { ApiError } from '../../services/api/apiClient';
import { useTeacherResource } from './useTeacherResource';
import { assignmentLabel, LoadState, styles } from './teacherUi';

const fingerprint = (content: NoticeContent) => JSON.stringify(content);
export default function TeacherNoticeScreen({
  route,
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherNotice'>) {
  const { accessToken, user } = useAuth();
  const canManage = hasPermission(
    user?.role,
    PERMISSIONS.TEACHER_NOTICES_MANAGE,
  );
  const [title, setTitle] = useState(''),
    [body, setBody] = useState('');
  const [language, setLanguage] = useState<'en' | 'ur'>('en');
  const [context, setContext] = useState<TeacherTupleIds | null>(null);
  const [preview, setPreview] = useState<RecipientPreview | null>(null);
  const [draft, setDraft] = useState<TeacherNotice | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const initialized = useRef(false),
    busy = useRef(false),
    generation = useRef(0);
  const operation = useRef<{
    id: string;
    revision: number;
    noticeId: string;
  } | null>(null);
  const activeNoticeId = route.params?.noticeId ?? draft?.noticeId;
  const load = useCallback(async () => {
    if (!accessToken) throw new Error('Sign in again to open notices.');
    const [assignments, notice] = await Promise.all([
      canManage
        ? teacherService.getAssignedClasses(accessToken)
        : Promise.resolve([]),
      activeNoticeId
        ? communicationService.notice(accessToken, activeNoticeId)
        : Promise.resolve(null),
    ]);
    return { assignments, notice };
  }, [accessToken, canManage, activeNoticeId]);
  const resource = useTeacherResource(
    load,
    'This notice is unavailable in your current scope.',
  );
  useFocusEffect(
    useCallback(() => {
      setPreview(null);
      return () => {
        generation.current += 1;
        busy.current = false;
        setPending(false);
      };
    }, []),
  );
  useEffect(() => {
    if (!resource.data || initialized.current) return;
    initialized.current = true;
    const notice = resource.data.notice;
    if (!notice) return;
    setDraft(notice);
    setTitle(notice.title);
    setBody(notice.body);
    setLanguage(notice.language ?? 'en');
    if (notice.classId && notice.sectionId && notice.subjectId) {
      const ids = {
        classId: notice.classId,
        sectionId: notice.sectionId,
        subjectId: notice.subjectId,
      };
      setContext(ids);
      setSavedContent(
        fingerprint({
          ...ids,
          title: notice.title,
          body: notice.body,
          language: notice.language ?? 'en',
          audienceType: 'class_students',
        }),
      );
    }
  }, [resource.data]);
  const content: NoticeContent | null = context
    ? { ...context, title, body, language, audienceType: 'class_students' }
    : null;
  const authorized = Boolean(
    resource.data?.assignments.some(
      t =>
        t.classId === context?.classId &&
        t.sectionId === context?.sectionId &&
        t.subjectId === context?.subjectId,
    ),
  );
  const currentNotice = resource.data?.notice;
  const published =
    draft?.state === 'published'
      ? draft
      : currentNotice?.state === 'published'
      ? currentNotice
      : null;
  const editable =
    canManage &&
    Boolean(resource.data) &&
    !published &&
    (!activeNoticeId || currentNotice?.canEdit === true);
  const valid =
    authorized && title.trim().length >= 2 && body.trim().length >= 2;
  const dirty = Boolean(content && fingerprint(content) !== savedContent);
  const invalidate = () => {
    setPreview(null);
    setError(null);
  };
  const run = async (action: 'preview' | 'draft' | 'send') => {
    if (busy.current || !accessToken || !content || !editable) return;
    if (!valid) {
      setError(
        'Choose a current class and enter a title and message of at least two characters.',
      );
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    const request = generation.current;
    try {
      if (action === 'preview') {
        const result = await communicationService.preview(accessToken, content);
        if (request === generation.current) setPreview(result);
      } else if (action === 'draft') {
        const result = await communicationService.draft(
          accessToken,
          content,
          draft?.revision != null
            ? { noticeId: draft.noticeId, revision: draft.revision }
            : undefined,
        );
        if (request === generation.current) {
          setDraft(result);
          setSavedContent(fingerprint(content));
          operation.current = null;
        }
      } else {
        if (!draft || draft.revision == null || dirty || !preview) return;
        if (
          !operation.current ||
          operation.current.revision !== draft.revision ||
          operation.current.noticeId !== draft.noticeId
        )
          operation.current = {
            id: noticeOperationId(),
            revision: draft.revision,
            noticeId: draft.noticeId,
          };
        const result = await communicationService.send(
          accessToken,
          draft.noticeId,
          draft.revision,
          operation.current.id,
        );
        if (request === generation.current) {
          setDraft(result);
          setPreview(p =>
            p ? { ...p, recipientCount: result.recipientCount ?? 0 } : p,
          );
        }
      }
    } catch (failure) {
      if (request !== generation.current) return;
      setError(
        failure instanceof Error
          ? failure.message
          : 'Notice operation failed. Please retry.',
      );
      // Preserve text and operation ID on failures. Authority errors require a
      // new preview; retries of uncertain sends keep the same operation.
      if (
        failure instanceof ApiError &&
        [401, 403, 404, 409].includes(failure.status)
      ) {
        setPreview(null);
        await resource.refresh();
      }
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  const display = resource.data
    ? published ?? (!editable ? currentNotice : null)
    : null;
  return (
    <DashboardShell refreshing={resource.loading} onRefresh={resource.refresh}>
      <Button
        title="Back to Inbox"
        variant="secondary"
        onPress={() => navigation.goBack()}
      />
      <ScreenHeading
        title={editable ? 'Draft notice' : 'Notice'}
        subtitle="School-app announcements"
      />
      <LoadState
        {...resource}
        retry={resource.refresh}
        label="Loading notice context..."
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.body}>
          {error}
        </Text>
      ) : null}
      {display ? (
        <SectionCard title={display.title}>
          <StatusBadge
            status={display.state === 'published' ? 'paid' : 'pending'}
            label={display.state === 'published' ? 'Published' : 'Draft'}
          />
          <Text style={styles.body}>{display.body}</Text>
          <Text style={styles.muted}>
            Language:{' '}
            {display.language === 'ur'
              ? 'Urdu'
              : display.language === 'en'
              ? 'English'
              : 'Not specified'}
          </Text>
          {display.deliveryState ? (
            <Text style={styles.muted}>
              Published internally for {display.recipientCount} current
              recipients. Delivery and read receipts are unavailable.
            </Text>
          ) : null}
          {display.state === 'draft' && !display.canEdit ? (
            <Text style={styles.muted}>
              Your current assignment no longer permits editing or sending this
              draft.
            </Text>
          ) : null}
        </SectionCard>
      ) : null}
      {editable ? (
        <>
          {currentNotice?.state === 'draft' &&
          draft &&
          currentNotice.revision !== draft.revision ? (
            <SectionCard title="Draft changed">
              <Text style={styles.muted}>
                Review the latest saved draft before replacing it. Your current
                input is preserved until you reload.
              </Text>
              <Button
                title="Reload saved draft"
                variant="secondary"
                disabled={pending}
                onPress={() => {
                  initialized.current = false;
                  setDraft(currentNotice);
                  setPreview(null);
                  operation.current = null;
                  resource.refresh();
                }}
              />
            </SectionCard>
          ) : null}
          <SectionCard title="Class audience">
            <Text style={styles.muted}>
              Students in one current class, section and subject context.
            </Text>
            {resource.data?.assignments.map(t => (
              <Button
                key={t.assignmentId}
                title={assignmentLabel(t)}
                disabled={pending}
                variant={
                  t.classId === context?.classId &&
                  t.sectionId === context?.sectionId &&
                  t.subjectId === context?.subjectId
                    ? 'primary'
                    : 'secondary'
                }
                onPress={() => {
                  setContext({
                    classId: t.classId,
                    sectionId: t.sectionId,
                    subjectId: t.subjectId,
                  });
                  invalidate();
                }}
              />
            ))}
            {!resource.data?.assignments.length ? (
              <Text style={styles.body}>No current authorized classes.</Text>
            ) : null}
          </SectionCard>
          <SectionCard title="Notice content">
            <Text style={styles.muted}>
              Use class-wide information only. Leave out private student notes
              and personal contact details.
            </Text>
            <TextInput
              accessibilityLabel="Notice title"
              value={title}
              maxLength={150}
              editable={!pending}
              style={styles.search}
              onChangeText={v => {
                setTitle(v);
                invalidate();
              }}
              placeholder="Title"
            />
            <TextInput
              accessibilityLabel="Notice body"
              value={body}
              maxLength={2000}
              multiline
              editable={!pending}
              style={styles.search}
              onChangeText={v => {
                setBody(v);
                invalidate();
              }}
              placeholder="Message"
            />
            <View>
              <Button
                title="English"
                disabled={pending}
                variant={language === 'en' ? 'primary' : 'secondary'}
                onPress={() => {
                  setLanguage('en');
                  invalidate();
                }}
              />
              <Button
                title="Urdu"
                disabled={pending}
                variant={language === 'ur' ? 'primary' : 'secondary'}
                onPress={() => {
                  setLanguage('ur');
                  invalidate();
                }}
              />
            </View>
            <Button
              title="Preview recipients"
              disabled={pending}
              onPress={() => run('preview')}
            />
          </SectionCard>
          {preview ? (
            <SectionCard title="Preview">
              <Text style={styles.body}>
                {assignmentLabel(preview.context)}
              </Text>
              <Text style={styles.body}>
                {preview.recipientCount} authorized recipients
              </Text>
              <Text style={styles.body}>{title}</Text>
              <Text style={styles.body}>{body}</Text>
              <Text style={styles.muted}>
                {language === 'en' ? 'English' : 'Urdu'} · Internal school app
                only
              </Text>
              <Text style={styles.muted}>
                Recipients will be rechecked when you send.
              </Text>
              <Button
                title={pending ? 'Working...' : 'Save draft'}
                disabled={pending || !valid}
                onPress={() => run('draft')}
              />
              {draft?.state === 'draft' ? (
                <Text style={styles.muted}>
                  Draft saved.{' '}
                  {dirty
                    ? 'Save your changes before sending.'
                    : 'Ready for explicit send.'}
                </Text>
              ) : null}
              <Button
                title="Send notice"
                disabled={pending || !draft || dirty || !preview.recipientCount}
                onPress={() => run('send')}
              />
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </DashboardShell>
  );
}
