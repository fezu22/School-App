import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { parentApi } from './parentService';
import {
  validateApplicationDraft,
  APPLICATION_TITLE_LIMIT,
  APPLICATION_MESSAGE_LIMIT,
} from '../../shared/utils/applicationValidation';
import { theme as t } from '../../theme/hiraTheme';
import PageIcon from '../../shared/components/PageIcon';
import {
  Action,
  ChildSelector,
  PreviewNote,
  State,
  childName,
  recordId,
  rows,
  u,
  useParentChildren,
} from './ParentWorkspaceUI';

const samples = [
  {
    id: 'PREVIEW-REQUEST-1',
    title: 'Leave request',
    message: 'Request for leave due to a family event.',
    status: 'submitted',
    createdAt: '2026-10-10',
    statusHistory: [
      {
        status: 'submitted',
        note: 'Sent to the class teacher.',
        changedAt: '2026-10-10',
      },
    ],
  },
  {
    id: 'PREVIEW-REQUEST-2',
    title: 'Early pickup request',
    message: 'Request to leave early for a medical appointment.',
    status: 'approved',
    createdAt: '2026-10-08',
    statusHistory: [
      {
        status: 'approved',
        note: 'Please check in at the school office.',
        changedAt: '2026-10-09',
      },
    ],
  },
];
export const isPendingApplication = item =>
  ['submitted', 'pending', 'in_review', 'under_review'].includes(
    String(item.status || '').toLowerCase(),
  );
export const isReviewedApplication = item =>
  ['approved', 'rejected', 'reviewed', 'needs_information'].includes(
    String(item.status || '').toLowerCase(),
  );
function dateText(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? date.toLocaleDateString()
    : 'Date not recorded';
}
function Status({ item }) {
  return (
    <View
      style={[
        u.badge,
        String(item.status).toLowerCase() === 'approved' && u.success,
      ]}
    >
      <Text style={u.badgeText}>
        {String(item.status || 'Status unavailable').replace(/_/g, ' ')}
      </Text>
    </View>
  );
}
export default function ParentApplicationsPage({
  previewOnly = false,
  initialChildId = '',
  onChildChange,
  pickup = false,
}) {
  const model = useParentChildren(previewOnly, initialChildId, onChildChange);
  const [data, setData] = useState({ childId: '', records: [] });
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('All');
  const [compose, setCompose] = useState(false),
    [detail, setDetail] = useState(null);
  const [title, setTitle] = useState(''),
    [message, setMessage] = useState(''),
    [formError, setFormError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    sending = useRef(false),
    activeChild = useRef(model.selectedId);
  activeChild.current = model.selectedId;
  useEffect(
    () => () => {
      activeChild.current = '';
    },
    [],
  );
  const load = useCallback(async () => {
    const id = model.selectedId,
      request = ++generation.current;
    setData({ childId: id, records: [] });
    setError('');
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = model.preview
        ? samples
        : await parentApi.getApplications(id);
      if (request === generation.current)
        setData({ childId: id, records: rows(result) });
    } catch (failure) {
      if (request === generation.current)
        setError(failure.message || 'Could not load applications.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [model.selectedId, model.preview]);
  useEffect(() => {
    setCompose(false);
    setDetail(null);
    setNotice('');
    setTitle('');
    setMessage('');
    setFormError('');
    setFilter('All');
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (compose || detail) {
          if (!sending.current) {
            setCompose(false);
            setDetail(null);
          }
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [compose, detail]);
  const openForm = () => {
    setTitle(pickup ? 'Early pickup request' : '');
    setMessage('');
    setFormError('');
    setCompose(true);
  };
  const closeForm = () => {
    if (!sending.current) setCompose(false);
  };
  const submit = async () => {
    if (sending.current || !model.selectedId) return;
    const validation = validateApplicationDraft(title, message);
    if (validation.error) {
      setFormError(validation.error);
      return;
    }
    if (model.preview) {
      setFormError('Preview only. Sign in to send a real request.');
      return;
    }
    const id = model.selectedId;
    sending.current = true;
    setBusy(true);
    setFormError('');
    try {
      await parentApi.submitApplication(id, validation.value);
      if (activeChild.current !== id) return;
      setCompose(false);
      setTitle('');
      setMessage('');
      setNotice('Application sent to the assigned class teacher.');
      await load();
    } catch (failure) {
      if (activeChild.current === id)
        setFormError(
          `${
            failure.message || 'Could not confirm submission.'
          } If your connection dropped, close this form and refresh the list before sending again.`,
        );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const records = data.childId === model.selectedId ? data.records : [];
  const filtered = records.filter(
    item =>
      (!pickup || /pickup|pick.up|early exit/i.test(item.title || '')) &&
      (filter === 'All' ||
        (filter === 'Pending'
          ? isPendingApplication(item)
          : isReviewedApplication(item))),
  );
  return (
    <>
      <ScrollView
        contentContainerStyle={u.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading || model.loading}
            onRefresh={() => {
              model.refresh();
            }}
            tintColor={t.primary}
          />
        }
      >
        <PreviewNote visible={model.preview} />
        {model.loading ? (
          <State loading title="Loading your children…" />
        ) : model.error ? (
          <State
            error
            title="Unable to load children"
            detail={model.error}
            onRetry={model.refresh}
          />
        ) : !model.children.length ? (
          <State
            title="No linked children yet"
            detail="A verified child link is needed to send an application."
          />
        ) : (
          <>
            <ChildSelector model={model} disabled={busy} />
            {pickup && (
              <View style={u.hero}>
                <PageIcon name="shield" size={36} color={t.primary} />
                <View style={u.flex}>
                  <Text style={u.cardTitle}>Plan a safe pickup</Text>
                  <Text style={u.muted}>
                    Send the pickup person's name, relationship, date, time and
                    reason. A request is not an approved gate pass.
                  </Text>
                </View>
              </View>
            )}
            <Action
              title={pickup ? 'Request early pickup' : '+ New application'}
              onPress={openForm}
              disabled={busy}
            />
            {!!notice && (
              <Text accessibilityRole="alert" style={u.link}>
                {notice}
              </Text>
            )}
            <View style={u.wrap}>
              {['All', 'Pending', 'Reviewed'].map(value => (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityLabel={`${value} applications`}
                  accessibilityState={{ selected: filter === value }}
                  onPress={() => setFilter(value)}
                  style={[u.chip, filter === value && u.chipActive]}
                >
                  <Text style={u.chipText}>{value}</Text>
                </Pressable>
              ))}
            </View>
            {loading ? (
              <State loading title="Loading applications…" />
            ) : error ? (
              <State
                error
                title="Applications could not load"
                detail={error}
                onRetry={load}
              />
            ) : !filtered.length ? (
              <State
                title="No applications here yet"
                detail="Your requests and the teacher's responses will appear here."
              />
            ) : (
              filtered.map(item => (
                <Pressable
                  key={recordId(item)}
                  style={u.card}
                  accessibilityRole="button"
                  accessibilityLabel={`Open application ${item.title}`}
                  onPress={() => setDetail(item)}
                >
                  <View style={u.row}>
                    <View style={u.avatar}>
                      <PageIcon name="file-pen" size={28} color={t.primary} />
                    </View>
                    <View style={u.flex}>
                      <Text style={u.cardTitle}>{item.title}</Text>
                      <Text style={u.muted}>{dateText(item.createdAt)}</Text>
                    </View>
                    <PageIcon name="chevron" size={18} />
                  </View>
                  <Status item={item} />
                  <Text numberOfLines={2} style={u.body}>
                    {item.message}
                  </Text>
                  <Text style={u.link}>View request and response</Text>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
      <Modal visible={compose} animationType="slide" onRequestClose={closeForm}>
        <KeyboardAvoidingView
          style={u.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[u.page, u.modalPage]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={u.title}>
              {pickup ? 'Early pickup request' : 'New application'}
            </Text>
            <Text style={u.muted}>
              For {childName(model.selected)} · sent to the assigned class
              teacher
            </Text>
            <Text style={u.label}>Subject</Text>
            <TextInput
              accessibilityLabel="Application subject"
              value={title}
              onChangeText={setTitle}
              editable={!busy}
              maxLength={APPLICATION_TITLE_LIMIT}
              style={u.input}
              placeholder="What is your request about?"
              placeholderTextColor={t.muted}
            />
            <Text style={u.label}>Message</Text>
            <TextInput
              accessibilityLabel="Application message"
              value={message}
              onChangeText={setMessage}
              editable={!busy}
              multiline
              textAlignVertical="top"
              maxLength={APPLICATION_MESSAGE_LIMIT}
              style={[u.input, u.messageInput]}
              placeholder={
                pickup
                  ? 'Pickup person, relationship, date, time and reason'
                  : 'Write your application'
              }
              placeholderTextColor={t.muted}
            />
            <Text style={u.muted}>
              {message.length}/{APPLICATION_MESSAGE_LIMIT}
            </Text>
            {!!formError && (
              <Text accessibilityRole="alert" style={u.error}>
                {formError}
              </Text>
            )}
            <Action
              title={busy ? 'Sending…' : 'Send application'}
              disabled={busy || model.preview || !model.selectedId}
              onPress={submit}
            />
            {model.preview && (
              <Text style={u.muted}>Design preview. Sign in to submit.</Text>
            )}
            <Action
              title="Close"
              secondary
              disabled={busy}
              onPress={closeForm}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={Boolean(detail)}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}
      >
        <View style={u.overlay}>
          <View style={u.sheet}>
            <ScrollView contentContainerStyle={u.stack}>
              <Text style={u.title}>{detail?.title}</Text>
              <Status item={detail || {}} />
              <Text style={u.body}>{detail?.message}</Text>
              <Text style={u.cardTitle}>Status history</Text>
              {rows(detail?.statusHistory).length ? (
                rows(detail?.statusHistory).map((entry, index) => (
                  <View key={index} style={u.card}>
                    <Text style={u.label}>
                      {String(entry.status || '').replace(/_/g, ' ')}
                    </Text>
                    <Text style={u.muted}>{dateText(entry.changedAt)}</Text>
                    {!!entry.note && <Text style={u.body}>{entry.note}</Text>}
                  </View>
                ))
              ) : (
                <Text style={u.muted}>
                  No response history is available yet.
                </Text>
              )}
            </ScrollView>
            <Action title="Close" secondary onPress={() => setDetail(null)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
