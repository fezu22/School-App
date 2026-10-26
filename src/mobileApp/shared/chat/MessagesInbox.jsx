import PageIcon from '../components/PageIcon';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme as t } from '../../theme/hiraTheme';
import { SchoolPanel, SchoolRow, schoolStyles } from '../components/SchoolReferenceUI';
import SchoolPageHero from '../components/SchoolPageHero';
import { parentApi } from '../../roles/parent/parentService';
import { studentApi } from '../../roles/student/studentService';
import { chatApi, createChatConnection, createClientMessageId, MAX_CHAT_ATTACHMENT_BYTES } from '../services/chatService';
import { getAuthHeaders } from '../services/authSession';
import { API_ROOT } from '../services/apiConfig';

function fullTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

function shortTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Button({ children, onPress, disabled, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={typeof children === 'string' ? children : undefined}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabled,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text
        style={[styles.buttonText, secondary && styles.secondaryButtonText]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

export default function MessagesInbox({
  role,
  userId,
  previewOnly = false,
  onNavigate,
}) {
  const [conversations, setConversations] = useState([]);
  const [children, setChildren] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(!previewOnly);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState(previewOnly ? 'preview' : 'connecting');
  const [sending, setSending] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selected, setSelected] = useState(null);
  const liveRef = useRef(true);
  const requestVersion = useRef(0);
  const messageVersion = useRef(0);
  const conversationRef = useRef(null);
  const socketRef = useRef(null);
  const pendingMessageRef = useRef(null);
  const currentUserId = String(userId || '');
  const isChatRole = ['Parent', 'Student', 'Teacher'].includes(role);
  const canStart = role === 'Parent' || role === 'Student';
  function personName(item) { return item.teacherName || item.studentName || item.name || 'Conversation'; }
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter(item => {
      const messageText = (item.messages || [])
        .map(message => message.body)
        .join(' ');
      return (
        (!unreadOnly || (item.unreadCount || item.unread || 0) > 0) &&
        (!query ||
          `${personName(item)} ${item.studentName || ''} ${item.teacherName || ''} ${item.subtitle || ''} ${item.lastMessage?.body || item.excerpt || ''} ${messageText}`
            .toLowerCase()
            .includes(query))
      );
    });
  }, [conversations, search, unreadOnly]);

  const loadConversations = useCallback(async (quiet = false) => {
    if (previewOnly || !isChatRole) return;
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await chatApi.getConversations();
      if (!liveRef.current || version !== requestVersion.current) return;
      setConversations(Array.isArray(response?.conversations) ? response.conversations : []);
    } catch (loadError) {
      if (liveRef.current && version === requestVersion.current) setError(loadError.message || 'Could not load conversations.');
    } finally {
      if (liveRef.current && version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, [isChatRole, previewOnly]);

  useEffect(() => {
    liveRef.current = true;
    if (!previewOnly && isChatRole) loadConversations();
    if (!previewOnly && isChatRole) {
      const connectionHandle = createChatConnection({
        onStatus: status => {
          if (liveRef.current) setConnection(status);
          if (status === 'connected' && liveRef.current) {
            loadConversations(true);
            const activeConversation = conversationRef.current;
            if (activeConversation?.id) {
              chatApi.getMessages(activeConversation.id).then(response => {
                if (!liveRef.current || conversationRef.current?.id !== activeConversation.id) return;
                setMessages((response?.messages || []).map(message => ({ ...message, mine: message.senderUserId === currentUserId })));
                setHasMore(!!response?.hasMore);
                setNextCursor(response?.nextCursor || null);
                return chatApi.markRead(activeConversation.id);
              }).catch(() => {});
            }
          }
        },
        onEvent: event => {
          if (!liveRef.current) return;
          loadConversations(true);
          if (event.conversationId !== conversationRef.current?.id) return;
          if (event.type === 'message.created') {
            const incoming = event.message;
            setMessages(current => current.some(item => item.id === incoming.id) ? current : [...current, { ...incoming, mine: incoming.senderUserId === currentUserId }]);
            if (incoming.senderUserId !== currentUserId) chatApi.markRead(event.conversationId).catch(() => {});
          } else if (event.type === 'read.receipt' && event.readerRole !== role.toLowerCase()) {
            const ids = new Set(event.messageIds || []);
            setMessages(current => current.map(item => ids.has(item.id) && item.mine ? { ...item, readByOther: true } : item));
          }
        },
      });
      socketRef.current = connectionHandle;
    }
    return () => {
      liveRef.current = false;
      requestVersion.current += 1;
      messageVersion.current += 1;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [currentUserId, isChatRole, loadConversations, previewOnly, role]);

  useEffect(() => {
    if (previewOnly || role !== 'Parent' || !showNew) return undefined;
    let active = true;
    parentApi.getChildren().then(result => {
      if (active) setChildren(Array.isArray(result) ? result : result?.children || []);
    }).catch(loadError => { if (active) setError(loadError.message || 'Could not load linked children.'); });
    return () => { active = false; };
  }, [previewOnly, role, showNew]);

  useEffect(() => {
    if (previewOnly || !showNew || !studentId) { setTeachers([]); return undefined; }
    let active = true;
    setTeachers([]); setSelectedTeacher(''); setError('');
    chatApi.getTeachers(studentId).then(response => {
      if (active) setTeachers(Array.isArray(response?.teachers) ? response.teachers : []);
    }).catch(loadError => { if (active) setError(loadError.message || 'Could not load assigned teachers.'); });
    return () => { active = false; };
  }, [previewOnly, showNew, studentId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (sending) return true;
        setSelectedId('');
        setSelected(null);
        setDraft('');
        setSelectedMedia(null);
        setUploadProgress(0);
        setUploadFailed(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [selectedId, sending]);

  useEffect(() => { conversationRef.current = selected; }, [selected]);

  const openConversation = useCallback(async item => {
    setSelectedId(item.id);
    setSelected(item);
    setDraft('');
    setSelectedMedia(null);
    setUploadProgress(0);
    setUploadFailed(false);
    pendingMessageRef.current = null;
    setMessages([]);
    setError('');
    if (previewOnly) {
      setMessages((item.messages || []).map(message => ({ ...message, mine: message.sender === 'me' })));
      setConversations(current => current.map(conversation => conversation.id === item.id ? { ...conversation, unread: 0 } : conversation));
      return;
    }
    const version = ++messageVersion.current;
    setLoadingMessages(true);
    try {
      const response = await chatApi.getMessages(item.id);
      if (!liveRef.current || version !== messageVersion.current) return;
      setMessages((response?.messages || []).map(message => ({ ...message, mine: message.senderUserId === currentUserId })));
      setHasMore(!!response?.hasMore);
      setNextCursor(response?.nextCursor || null);
      await chatApi.markRead(item.id);
      loadConversations(true);
    } catch (loadError) {
      if (liveRef.current && version === messageVersion.current) setError(loadError.message || 'Could not load this conversation.');
    } finally {
      if (liveRef.current && version === messageVersion.current) setLoadingMessages(false);
    }
  }, [currentUserId, loadConversations, previewOnly]);

  const startConversation = async () => {
    if (!studentId || !selectedTeacher || creating) return;
    setCreating(true); setError('');
    try {
      const item = await chatApi.startConversation(studentId, selectedTeacher);
      setShowNew(false);
      setSelected(item);
      setSelectedId(item.id);
      await loadConversations(true);
      await openConversation(item);
    } catch (startError) { setError(startError.message || 'Could not start this conversation.'); }
    finally { setCreating(false); }
  };

  const loadEarlier = async () => {
    if (!nextCursor || !selected || loadingMessages) return;
    const version = messageVersion.current;
    setLoadingMessages(true);
    try {
      const response = await chatApi.getMessages(selected.id, nextCursor);
      if (!liveRef.current || version !== messageVersion.current) return;
      const earlier = (response?.messages || []).map(message => ({ ...message, mine: message.senderUserId === currentUserId }));
      setMessages(current => [...earlier, ...current.filter(item => !earlier.some(old => old.id === item.id))]);
      setHasMore(!!response?.hasMore);
      setNextCursor(response?.nextCursor || null);
    } catch (loadError) { setError(loadError.message || 'Could not load earlier messages.'); }
    finally { if (liveRef.current && version === messageVersion.current) setLoadingMessages(false); }
  };

  const chooseMedia = async () => {
    if (previewOnly || sending) return;
    const { errorCodes, isErrorWithCode, pick, types } = require('@react-native-documents/picker');
    try {
      const [file] = await pick({ type: [types.images], allowMultiSelection: false });
      if (!file || file.hasRequestedType === false) {
        setError('Choose a JPEG, PNG, or WebP image.');
        return;
      }
      const mime = String(file.type || '').toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        setError('Choose a JPEG, PNG, or WebP image.');
        return;
      }
      if (file.size != null && file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        setError('Images must be 10 MB or smaller.');
        return;
      }
      setSelectedMedia(file);
      setUploadProgress(0);
      setUploadFailed(false);
      setError('');
      pendingMessageRef.current = null;
    } catch (pickerError) {
      if (isErrorWithCode(pickerError) && pickerError.code === errorCodes.OPERATION_CANCELED) return;
      setError(pickerError.message || 'The image picker could not be opened.');
    }
  };

  const sendLiveMessage = async () => {
    const body = draft.trim();
    if ((!body && !selectedMedia) || !selected || sending) return;
    setSending(true); setError('');
    try {
      const signature = `${body}\u0000${selectedMedia?.uri || ''}`;
      if (pendingMessageRef.current?.signature !== signature) {
        pendingMessageRef.current = { body, signature, id: createClientMessageId() };
      }
      setUploadFailed(false);
      setUploadProgress(0);
      const response = selectedMedia
        ? await chatApi.uploadAttachment({
            conversationId: selected.id,
            file: selectedMedia,
            body,
            clientMessageId: pendingMessageRef.current.id,
            onProgress: (loaded, total) => setUploadProgress(Math.min(100, Math.round((loaded / total) * 100))),
          })
        : await chatApi.sendMessage(selected.id, body, pendingMessageRef.current.id);
      const message = response?.message;
      if (!message) throw new Error('The message was not confirmed by the server.');
      setMessages(current => current.some(item => item.id === message.id) ? current : [...current, { ...message, mine: true }]);
      pendingMessageRef.current = null;
      setDraft('');
      setSelectedMedia(null);
      setUploadProgress(0);
      loadConversations(true);
    } catch (sendError) {
      if (selectedMedia) setUploadFailed(true);
      setError(sendError.message || 'Message could not be sent.');
    }
    finally { setSending(false); }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.eyebrow}>{role?.toUpperCase() || 'SCHOOL'} · MESSAGES</Text>
        {!selected ? (
          <SchoolPageHero
            title="Keep in touch"
            subtitle="Your conversations with the school, together in one place."
            icon="message"
          />
        ) : null}
        <Text style={schoolStyles.title}>{selected ? personName(selected) : 'A little conversation goes a long way.'}</Text>
        <Text style={styles.subtitle}>
          {selected
            ? `${selected.studentName ? `${selected.studentName} · ` : ''}${connection === 'connected' ? 'Live' : connection === 'preview' ? 'Local preview' : connection}`
            : 'Direct messages with a teacher assigned to the student. Notifications remain on their own page.'}
        </Text>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        {selected ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to conversations"
              accessibilityState={{ disabled: sending }}
              disabled={sending}
              onPress={() => {
                if (sending) return;
                setSelectedId('');
                setSelected(null);
                setDraft('');
                setSelectedMedia(null);
                setUploadProgress(0);
                setUploadFailed(false);
              }}
              style={styles.back}
            >
              <PageIcon name="chevron" size={18} style={styles.backIcon} />
              <Text style={styles.backText}>All conversations</Text>
            </Pressable>
            <View style={styles.threadHeading}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {personName(selected).slice(0, 1)}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.threadName}>{personName(selected)}</Text>
                <Text style={styles.muted}>{selected.studentName || (connection === 'connected' ? 'Real-time conversation' : connection)}</Text>
              </View>
            </View>
            {hasMore ? <Button secondary onPress={loadEarlier}>Load earlier messages</Button> : null}
            <View style={styles.messageList}>
              {loadingMessages ? <ActivityIndicator color={t.primary} /> : null}
              {!loadingMessages && messages.length === 0 ? <Text style={styles.muted}>{error ? 'Messages could not be loaded.' : 'No messages yet. Start the conversation below.'}</Text> : null}
              {!loadingMessages && messages.length === 0 && error ? <Button secondary onPress={() => openConversation(selected)}>Retry messages</Button> : null}
              {messages.map(message => {
                const mine = !!message.mine;
                return (
                  <View
                    key={message.id}
                    style={[styles.messageRow, mine && styles.mineRow]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.mineBubble : styles.theirBubble,
                      ]}
                    >
                      <Text
                        style={[styles.messageText, mine && styles.mineText]}
                      >
                        {message.body}
                      </Text>
                      {(message.attachments || []).map(attachment => (
                        <Image
                          key={attachment.id}
                          accessibilityLabel="Message image attachment"
                          source={{
                            uri: `${API_ROOT}/chat/attachments/${encodeURIComponent(attachment.id)}`,
                            headers: getAuthHeaders(),
                          }}
                          resizeMode="cover"
                          style={styles.messageImage}
                        />
                      ))}
                      <Text
                        style={[styles.timestamp, mine && styles.mineTimestamp]}
                      >
                        {fullTime(message.createdAt)}{mine && !previewOnly ? ` · ${message.readByOther ? 'Seen' : 'Sent'}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <>
            {canStart && !previewOnly ? <Button onPress={() => { setShowNew(true); setError(''); }}>New conversation</Button> : null}
            {showNew && canStart && !previewOnly ? <SchoolPanel title="Message an assigned teacher">
              {role === 'Parent' ? <>
                <Text style={styles.muted}>Choose one of your verified linked children.</Text>
                {children.length === 0 ? <Button secondary onPress={async () => { try { setChildren((await parentApi.getChildren()) || []); } catch (e) { setError(e.message || 'Could not load children.'); } }}>Load children</Button> : null}
                {children.map(child => { const id = String(child.id || child.studentId || child._id || ''); return <Button key={id} secondary onPress={() => setStudentId(id)}>{`${studentId === id ? '✓ ' : ''}${child.fullName || child.name || 'Student'}`}</Button>; })}
              </> : <Button secondary onPress={async () => { try { const profile = await studentApi.getProfile(); const id = String(profile?.id || profile?.student?.id || profile?.studentId || ''); setStudentId(id); if (!id) setError('Your student profile did not include an ID.'); } catch (e) { setError(e.message || 'Could not load your profile.'); } }}>Use my student profile</Button>}
              {teachers.map(teacher => <Button key={teacher.id} secondary onPress={() => setSelectedTeacher(teacher.id)}>{`${selectedTeacher === teacher.id ? '✓ ' : ''}${teacher.fullName || teacher.name || 'Assigned teacher'}${teacher.subject ? ` · ${teacher.subject}` : ''}`}</Button>)}
              {studentId && teachers.length === 0 ? <Text style={styles.muted}>No currently assigned teachers are available for this student.</Text> : null}
              <Button disabled={!studentId || !selectedTeacher || creating} onPress={startConversation}>{creating ? 'Opening…' : 'Open conversation'}</Button>
              <Button secondary onPress={() => { setShowNew(false); setStudentId(''); setTeachers([]); }}>Cancel</Button>
            </SchoolPanel> : null}
            <View style={styles.searchBox}>
              <PageIcon name="search" size={19} />
              <TextInput
                accessibilityLabel="Search conversations"
                placeholder="Search conversations"
                placeholderTextColor={t.muted}
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                returnKeyType="search"
              />
              {search ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch('')}
                >
                  <PageIcon name="close" size={18} color={t.muted} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.tabs}>
              {[false, true].map(unread => (
                <Pressable
                  key={String(unread)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: unreadOnly === unread }}
                  onPress={() => setUnreadOnly(unread)}
                  style={[
                    styles.tab,
                    unreadOnly === unread && styles.tabActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      unreadOnly === unread && styles.tabActiveText,
                    ]}
                  >
                    {unread ? 'Unread' : 'All conversations'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <SchoolPanel title="School inbox">
            {previewOnly ? (
              filtered.map((item, index) => (
                <SchoolRow
                  key={item.id}
                  icon={item.icon}
                  title={item.name}
                  subtitle={`${
                    item.excerpt ||
                    item.messages?.[item.messages.length - 1]?.body ||
                    ''
                  }${item.updatedAt ? ` · ${shortTime(item.updatedAt)}` : ''}`}
                  badge={item.unreadCount ? `${item.unreadCount} new` : item.unread ? `${item.unread} new` : 'Read'}
                  action={item.action}
                  last={index === filtered.length - 1}
                  onPress={() => openConversation(item)}
                />
              ))
            ) : !isChatRole ? (
              <View style={styles.unavailable}>
                <View style={styles.unavailableIcon}>
                  <PageIcon name="message" size={32} />
                </View>
                <Text style={styles.sectionTitle}>
                  Messaging is not available for this role
                </Text>
                <Text style={styles.muted}>
                  Chat access is limited to students, verified parents and assigned teachers.
                </Text>
              </View>
            ) : loading ? <ActivityIndicator color={t.primary} /> : error && conversations.length === 0 ? <View style={styles.empty}><Text style={styles.sectionTitle}>Could not load conversations</Text><Button secondary onPress={() => loadConversations()}>Retry</Button></View> : filtered.map((item, index) => (
              <SchoolRow key={item.id} icon="👩‍🏫" title={personName(item)} subtitle={`${item.lastMessage?.body || 'No messages yet'}${item.updatedAt ? ` · ${shortTime(item.updatedAt)}` : ''}`} badge={item.unreadCount ? `${item.unreadCount} new` : 'Read'} action="Open" last={index === filtered.length - 1} onPress={() => openConversation(item)} />
            ))}
            {filtered.length === 0 && !loading && !error ? (
              <View style={styles.empty}>
                <Text style={styles.sectionTitle}>{search || unreadOnly ? 'No conversations found' : previewOnly ? 'No sample conversations' : 'No conversations yet'}</Text>
                <Text style={styles.muted}>
                  {search || unreadOnly ? 'Try another search or show all conversations.' : previewOnly ? 'Sign in to see conversations with teachers assigned to you. Preview does not create or send messages.' : 'Start a conversation with a teacher assigned to this student.'}
                </Text>
              </View>
            ) : null}
            {!previewOnly && conversations.length > 0 ? <Button secondary onPress={() => loadConversations(true)}>Refresh</Button> : null}
            </SchoolPanel>
          </>
        )}

        {selected ? (
          <View style={[styles.composer, selectedMedia && styles.composerWithMedia]}>
            {!previewOnly ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Attach image"
                accessibilityState={{ disabled: sending }}
                disabled={sending}
                onPress={chooseMedia}
                style={styles.attachButton}
              >
                <Text style={styles.attachText}>＋ Photo</Text>
              </Pressable>
            ) : null}
            <TextInput
              accessibilityLabel="Write a message"
              placeholder={
                previewOnly ? 'Write a preview message…' : 'Write a message…'
              }
              placeholderTextColor={t.muted}
              value={draft}
              onChangeText={value => {
                setDraft(value);
                if (value.trim() !== pendingMessageRef.current?.body)
                  pendingMessageRef.current = null;
              }}
              editable={!!selected && !sending}
              multiline
              style={[
                styles.composerInput,
                sending && styles.composerDisabled,
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                'Send message'
              }
                accessibilityState={{
                  disabled: !selected || (!draft.trim() && !selectedMedia) || sending || uploadFailed,
                }}
              disabled={!selected || (!draft.trim() && !selectedMedia) || sending || uploadFailed}
              onPress={sendLiveMessage}
              style={({ pressed }) => [
                styles.send,
                (!selected || (!draft.trim() && !selectedMedia) || sending || uploadFailed) && styles.disabled,
                pressed && { opacity: 0.8 },
              ]}
            >
              <PageIcon name="message" size={19} color="#FFFFFF" />
            </Pressable>
            {selectedMedia ? (
              <View style={styles.pendingMedia}>
                <Text style={styles.pendingMediaName} numberOfLines={1}>{selectedMedia.name || 'Selected image'}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Remove selected image" disabled={sending} onPress={() => { setSelectedMedia(null); setUploadProgress(0); setUploadFailed(false); pendingMessageRef.current = null; }}>
                  <Text style={styles.removeMedia}>Remove</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
        {selectedMedia && sending ? (
          <View accessibilityLiveRegion="polite" style={styles.uploadStatus}>
            <Text style={styles.muted}>Uploading image · {uploadProgress}%</Text>
            <View style={styles.uploadTrack}><View style={[styles.uploadFill, { width: `${uploadProgress}%` }]} /></View>
          </View>
        ) : null}
        {selectedMedia && uploadFailed && !sending ? (
          <Button secondary onPress={sendLiveMessage}>Retry image upload</Button>
        ) : null}
        {previewOnly ? (
          <Text style={[schoolStyles.preview, styles.previewSpacing]}>
            Development Preview · no sample conversations or messages are created.
          </Text>
        ) : null}
        <Button secondary onPress={() => onNavigate('Home')}>
          Back to Overview
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 10, marginBottom: 18, flexWrap: 'wrap' },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#EEEDFF',
  },
  tabActive: { backgroundColor: '#4857B5' },
  tabText: { color: '#4857B5', fontSize: 12, fontWeight: '700' },
  tabActiveText: { color: '#FFFFFF' },
  flex: { flex: 1 },
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 30 },
  eyebrow: {
    color: '#74868E',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  title: {
    color: t.ink,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '900',
    marginTop: 10,
  },
  subtitle: {
    color: t.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
    marginBottom: 20,
  },
  error: {
    color: '#A12828',
    backgroundColor: '#FCECEC',
    borderRadius: 12,
    padding: 11,
    marginBottom: 12,
    fontSize: 12,
    lineHeight: 18,
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    marginBottom: 14,
    borderRadius: 15,
    backgroundColor: '#FFF0CF',
  },
  previewText: {
    flex: 1,
    color: '#755518',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  searchBox: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 16,
    marginBottom: 10,
  },
  searchInput: { flex: 1, minHeight: 44, color: t.ink, fontSize: 14 },
  conversation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 96,
    padding: 16,
    marginBottom: 8,
    backgroundColor: t.paper,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: t.border,
  },
  conversationCopy: { flex: 1 },
  conversationTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  conversationBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 7,
  },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 16,
    backgroundColor: t.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: t.primary, fontSize: 17, fontWeight: '800' },
  threadName: { flex: 1, color: t.ink, fontSize: 14, fontWeight: '800' },
  time: { color: t.muted, fontSize: 10 },
  previewMessage: { flex: 1, color: t.muted, fontSize: 12 },
  unreadBadge: {
    minWidth: 21,
    height: 21,
    borderRadius: 11,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.primary,
  },
  unreadText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  unavailable: {
    alignItems: 'center',
    padding: 22,
    marginTop: 8,
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 23,
    ...t.shadow,
  },
  unavailableIcon: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: t.lavender,
    marginBottom: 12,
  },
  sectionTitle: {
    color: t.ink,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 7,
  },
  muted: { color: t.muted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 24 },
  back: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
    marginBottom: 8,
  },
  backIcon: { transform: [{ rotate: '180deg' }] },
  backText: { color: t.primary, fontSize: 13, fontWeight: '700' },
  threadHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    marginBottom: 16,
    backgroundColor: t.paper,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.border,
  },
  messageList: { gap: 10, paddingBottom: 12 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  mineRow: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '85%',
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 18,
  },
  theirBubble: {
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
    borderTopLeftRadius: 5,
  },
  mineBubble: { backgroundColor: t.primary, borderTopRightRadius: 5 },
  messageImage: {
    width: 220,
    height: 170,
    marginTop: 7,
    borderRadius: 12,
    backgroundColor: t.lavender,
  },
  messageText: { color: t.ink, fontSize: 14, lineHeight: 20 },
  mineText: { color: '#FFFFFF' },
  timestamp: { color: t.muted, fontSize: 9, marginTop: 5 },
  mineTimestamp: { color: '#E1E3FF', textAlign: 'right' },
  previewSpacing: { marginTop: 18 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
    padding: 8,
    marginTop: 10,
    marginBottom: 14,
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 19,
  },
  composerWithMedia: { marginBottom: 38 },
  composerInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 110,
    paddingHorizontal: 10,
    paddingTop: 10,
    color: t.ink,
    fontSize: 13,
  },
  attachButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: t.lavender,
  },
  attachText: { color: t.primary, fontSize: 12, fontWeight: '800' },
  pendingMedia: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: -30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pendingMediaName: { flex: 1, color: t.muted, fontSize: 10 },
  removeMedia: { color: '#A12828', fontSize: 10, fontWeight: '700' },
  uploadStatus: { marginBottom: 12, gap: 7 },
  uploadTrack: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: t.border },
  uploadFill: { height: 5, backgroundColor: t.primary },
  composerDisabled: { opacity: 0.6 },
  send: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.primary,
  },
  disabled: { opacity: 0.42 },
  button: {
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingHorizontal: 17,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: t.primary,
    ...t.shadow,
  },
  secondaryButton: {
    backgroundColor: t.lavender,
    elevation: 0,
    shadowOpacity: 0,
  },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  secondaryButtonText: { color: t.primary },
});
