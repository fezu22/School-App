import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {Button, Card, SectionCard, StatusBadge} from '../../components/hiraDashboard';
import {AdminDialog, AdminFeedback, AdminSelect} from '../../components/hiraDashboard/AdminForm';
import {colors, spacing, typography} from '../../theme/hiraDashboard';
import {useAuth} from '../../context/AuthContext';
import {hasPermission, PERMISSIONS} from '../../constants/permissions';
import {ApiError} from '../../services/api/apiClient';
import {classSubjectService as service, type ClassSubjectRecord} from '../../services/admin/classSubjectService';
import {useTeacherResource} from '../teacher/useTeacherResource';
function message(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return 'You no longer have permission to manage Class Subjects.';
  if (error instanceof ApiError && error.status === 404) return 'This Class or Subject is no longer available in your branch. Refresh and retry.';
  return error instanceof Error ? error.message : 'Unable to contact the server. Please retry.';
}
export default function ClassSubjectsPanel({classId, branchId}: {classId: string; branchId?: string}) {
  const {accessToken, user} = useAuth();
  const manage = hasPermission(user?.role, PERMISSIONS.ACADEMIC_CLASS_SUBJECTS_MANAGE);
  const [offset, setOffset] = useState(0), [optionOffset, setOptionOffset] = useState(0);
  const [adding, setAdding] = useState(false), [subjectId, setSubjectId] = useState('');
  const [confirmation, setConfirmation] = useState<ClassSubjectRecord | null>(null);
  const [busy, setBusy] = useState(false), [validation, setValidation] = useState('');
  const [feedback, setFeedback] = useState<{kind: 'success' | 'error'; title: string; message: string} | null>(null);
  const pending = useRef(false), alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const load = useCallback(async () => {
    if (!accessToken) throw new Error('Sign in to view Class Subjects.');
    const records = await service.list(accessToken, classId, branchId, offset);
    const options = manage && records.writable ? await service.options(accessToken, classId, branchId, optionOffset) : null;
    return {records, options};
  }, [accessToken, classId, branchId, offset, optionOffset, manage]);
  const resource = useTeacherResource(load, 'This Class is no longer available in your branch.');
  const data = resource.data, writable = manage && data?.records.writable;
  async function mutate(operation: () => Promise<unknown>, title: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFeedback(null);
    try {
      await operation();
      if (!alive.current) return;
      setAdding(false); setConfirmation(null); setSubjectId(''); setValidation('');
      setFeedback({kind: 'success', title, message: 'The server confirmed your curriculum change.'});
      await resource.refresh();
    } catch (error) {if (alive.current) setFeedback({kind: 'error', title: 'Change not saved', message: message(error)});}
    finally {pending.current = false; if (alive.current) setBusy(false);}
  }
  const refresh = () => {if (!busy) {setAdding(false); setConfirmation(null); setSubjectId(''); setValidation(''); setFeedback(null); resource.refresh();}};
  const save = () => {
    if (!subjectId) {setValidation('Select an available Branch Subject.'); return;}
    if (!accessToken) return;
    mutate(() => service.create(accessToken, classId, subjectId, branchId), 'Subject added to Class');
  };
  return <View>
    <SectionCard title="Class Subjects"><Text style={styles.copy}>Define the Subjects officially available for this Class. Teacher Assignments, new Timetables and Syllabuses use this curriculum.</Text>{data ? <Text style={styles.muted}>{data.records.class.name} ({data.records.class.code}) · {data.records.period?.name ?? 'Legacy Class — Academic Period migration required'}</Text> : null}</SectionCard>
    <Button title="Refresh Class Subjects" variant="secondary" disabled={busy} onPress={refresh} />
    {resource.loading ? <ActivityIndicator accessibilityLabel="Loading Class Subjects" color={colors.primary} /> : null}
    {resource.error ? <><AdminFeedback kind="error" title="Class Subjects unavailable" message={resource.error} /><Button title="Retry Class Subjects" variant="secondary" onPress={resource.refresh} /></> : null}
    {feedback && !adding && !confirmation ? <AdminFeedback {...feedback} /> : null}
    {data ? <>
      {writable ? <Button title="Add Subject to Class" disabled={busy || resource.loading} onPress={() => {setAdding(true); setSubjectId(''); setValidation(''); setFeedback(null);}} /> : <Text style={styles.muted}>Class Subjects are read-only here. An active Class and current Academic Period are required for changes.</Text>}
      {!data.records.items.length ? <Card style={styles.card}><Text style={styles.heading}>No Class Subjects yet</Text><Text style={styles.muted}>Add an available Branch Subject to define this Class's curriculum.</Text></Card> : data.records.items.map(row => <Card key={row.id} style={styles.card}>
        <View style={styles.row}><Text style={styles.heading}>{row.subject.name}</Text><StatusBadge status={row.isActive ? 'paid' : 'unpaid'} label={row.isActive ? 'Active' : 'Inactive'} /></View>
        {!row.subject.isActive ? <Text style={styles.muted}>Subject is inactive in the Branch catalog.</Text> : null}
        {writable ? <Button title={(row.isActive ? 'Deactivate ' : 'Reactivate ') + row.subject.name} variant={row.isActive ? 'danger' : 'secondary'} disabled={busy || (!row.isActive && !row.subject.isActive)} onPress={() => {setConfirmation(row); setFeedback(null);}} /> : null}
      </Card>)}
      <View style={styles.row}>{offset > 0 ? <Button title="Previous Class Subjects" variant="secondary" disabled={busy} onPress={() => setOffset(Math.max(0, offset - 50))} /> : null}{data.records.nextOffset !== null ? <Button title="More Class Subjects" variant="secondary" disabled={busy} onPress={() => setOffset(data.records.nextOffset!)} /> : null}</View>
    </> : null}
    <AdminDialog visible={adding} title="Add Subject to Class" confirmTitle="Add Subject" busy={busy} busyLabel="Adding Class Subject" onConfirm={save} onClose={() => {if (!busy) {setAdding(false); setFeedback(null);}}}>
      {resource.loading ? <Text style={styles.copy}>Loading available Subjects...</Text> : data?.options?.items.length ? <AdminSelect label="Available Subject" placeholder="Select a Subject" value={subjectId} options={data.options.items.map(row => ({id: row.id, label: row.name}))} onSelect={id => {setSubjectId(id); setValidation('');}} disabled={busy} helper="Only active Branch Subjects not previously added are available." /> : <Text style={styles.copy}>No Subjects remain to add on this page. Reactivate an inactive entry, or add a Subject in the separate Branch catalog.</Text>}
      <View style={styles.row}>{optionOffset > 0 ? <Button title="Previous available Subjects" variant="secondary" disabled={busy} onPress={() => {setOptionOffset(Math.max(0, optionOffset - 50)); setSubjectId('');}} /> : null}{data?.options?.nextOffset !== null && data?.options?.nextOffset !== undefined ? <Button title="More available Subjects" variant="secondary" disabled={busy} onPress={() => {setOptionOffset(data.options!.nextOffset!); setSubjectId('');}} /> : null}</View>
      {validation ? <Text accessibilityRole="alert" style={styles.validation}>{validation}</Text> : null}{feedback ? <><AdminFeedback {...feedback} />{feedback.kind === 'error' ? <Button title="Reload Class Subjects" variant="secondary" disabled={busy} onPress={refresh} /> : null}</> : null}
    </AdminDialog>
    <AdminDialog visible={!!confirmation} title="Confirm Class Subject change" confirmTitle="Confirm change" busy={busy} busyLabel="Updating Class Subject" danger={!!confirmation?.isActive} onClose={() => {if (!busy) {setConfirmation(null); setFeedback(null);}}} onConfirm={() => {if (confirmation && accessToken) mutate(() => service.lifecycle(accessToken, classId, confirmation, confirmation.isActive ? 'deactivate' : 'reactivate', branchId), 'Class Subject updated');}}>
      <Text style={styles.copy}>{confirmation ? (confirmation.isActive ? 'Deactivate ' : 'Reactivate ') + confirmation.subject.name + ' for this Class?' : ''}</Text><Text style={styles.muted}>History is retained. Active assignments, published syllabuses and current or future approved timetables must be resolved before deactivation.</Text>{feedback ? <><AdminFeedback {...feedback} />{feedback.kind === 'error' ? <Button title="Reload Class Subjects" variant="secondary" disabled={busy} onPress={refresh} /> : null}</> : null}
    </AdminDialog>
  </View>;
}
const styles = StyleSheet.create({copy: {...typography.body, color: colors.ink}, muted: {...typography.small, color: colors.muted, marginVertical: spacing.sm}, heading: {...typography.h3, color: colors.ink, flex: 1}, card: {marginTop: spacing.md, marginBottom: spacing.md, gap: spacing.sm}, row: {flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap'}, validation: {...typography.small, color: colors.danger.text, marginTop: spacing.sm}});
