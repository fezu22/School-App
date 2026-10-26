import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, BackHandler, StyleSheet, Text, TextInput, View, type TextInputProps} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {PrincipalStackParamList} from '../../navigation/PrincipalNavigator';
import {StudentAdmissionForm, StudentProfilePanel} from './StudentProfileForms';
import {useAuth} from '../../context/AuthContext';
import {Button, Card, DashboardShell, ScreenHeading, SectionCard, StatusBadge} from '../../components/hiraDashboard';
import {AdminDialog, AdminFeedback, AdminSelect, formStyles} from '../../components/hiraDashboard/AdminForm';
import {colors, spacing, typography} from '../../theme/hiraDashboard';
import {enrollmentService as service, type Enrollment, type EnrollmentAction, type EnrollmentDetail, type EnrollmentOptions} from '../../services/admin/enrollmentService';
import {useTeacherResource} from '../teacher/useTeacherResource';
import {ApiError} from '../../services/api/apiClient';
import {hasPermission, PERMISSIONS} from '../../constants/permissions';
function AdminInput({label: title, ...props}: TextInputProps & {label: string}) {return <View><Text style={formStyles.label}>{title}</Text><TextInput {...props} accessibilityLabel={title} style={formStyles.input} placeholderTextColor={colors.muted} /></View>;}
const label = (row: Enrollment | null) => row ? `${row.period.name} / ${row.class.name} / ${row.section.name}` : 'No current enrollment';
const actionLabels: Record<EnrollmentAction, string> = {enroll: 'Enroll', transfer: 'Transfer Section', promote: 'Promote', withdraw: 'Withdraw'};
const operationId = () => 'enrollment_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14);
const errorMessage = (error: unknown) => error instanceof ApiError && error.status === 403 ? 'Your enrollment permission has changed. Refresh or contact your administrator.' : error instanceof ApiError && error.status === 404 ? 'This Student or academic context is unavailable in your Branch. Refresh and retry.' : error instanceof Error ? error.message : 'Unable to contact the server. Refresh and retry.';
export default function StudentEnrollmentScreen() {
  const {accessToken, user} = useAuth();
  return <EnrollmentContent key={(accessToken ?? 'signed-out') + ':' + (user?.branchId ?? '')} />;
}
function EnrollmentContent() {
  const {accessToken, user} = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<PrincipalStackParamList>>();
  const [admitting, setAdmitting] = useState(false);
  const [outcome, setOutcome] = useState(false);
  const [profileEpoch, setProfileEpoch] = useState(0);
  const [search, setSearch] = useState(''), [status, setStatus] = useState(''), [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<EnrollmentDetail | null>(null), [historyOffset, setHistoryOffset] = useState(0);
  const [action, setAction] = useState<EnrollmentAction | null>(null), [options, setOptions] = useState<EnrollmentOptions | null>(null), [optionOffset, setOptionOffset] = useState(0);
  const [classId, setClassId] = useState(''), [sectionId, setSectionId] = useState(''), [reason, setReason] = useState(''), [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false), [loadingDetail, setLoadingDetail] = useState(false), [feedback, setFeedback] = useState<{kind: 'success' | 'error'; title: string; message: string} | null>(null);
  const pending = useRef(false), operation = useRef(operationId()), frozen = useRef<Record<string, unknown> | null>(null), selection = useRef(0), optionRequest = useRef(0);
  useEffect(() => {const listener = BackHandler.addEventListener('hardwareBackPress', () => {
    if (pending.current) return true;
    if (selected) {selection.current++; optionRequest.current++; setSelected(null); setDetail(null); setAction(null); return true;}
    return false;
  }); return () => {listener.remove();};}, [selected]);
  useEffect(() => () => {selection.current += 1; optionRequest.current += 1;}, []);
  const load = useCallback(() => {if (!accessToken) throw new Error('Sign in to view Students.'); return service.list(accessToken, search, status, offset);}, [accessToken, search, status, offset]);
  const resource = useTeacherResource(load, 'Students are unavailable in your Branch.');
  async function openStudent(id: string, page = 0) {
    if (!accessToken || pending.current) return;
    const request = ++selection.current; optionRequest.current++;
    setSelected(id); setHistoryOffset(page); setLoadingDetail(true); setFeedback(null); setAction(null); setConfirming(false); setDetail(null);
    try {const result = await service.detail(accessToken, id, page); if (request === selection.current) setDetail(result);}
    catch (error) {if (request === selection.current) setFeedback({kind: 'error', title: 'Student unavailable', message: errorMessage(error)});}
    finally {if (request === selection.current) setLoadingDetail(false);}
  }
  async function loadOptions(targetClass?: string, page = 0) {
    if (!accessToken) return;
    const request = ++optionRequest.current; setLoadingDetail(true); setOptions(null);
    try {const next = await service.options(accessToken, targetClass, page); if (request === optionRequest.current) {setOptions(next); setOptionOffset(page);}}
    catch (error) {if (request === optionRequest.current) setFeedback({kind: 'error', title: 'Academic options unavailable', message: errorMessage(error)});}
    finally {if (request === optionRequest.current) setLoadingDetail(false);}
  }
  async function begin(next: EnrollmentAction) {
    setOutcome(false);
    setAction(next); setConfirming(false); setFeedback(null); setClassId(next === 'transfer' ? detail!.current!.class.id : ''); setSectionId(''); setReason(''); setOptions(null); operation.current = operationId(); frozen.current = null;
    if (next !== 'withdraw') await loadOptions(next === 'transfer' ? detail!.current!.class.id : undefined);
  }
  function preview() {
    if (!action) return;
    if (reason.trim().length < 3 || (action !== 'withdraw' && (!options?.period || !classId || !sectionId))) {setFeedback({kind: 'error', title: 'Complete enrollment details', message: 'Choose the target Class and Section and provide a reason of at least three characters.'}); return;}
    frozen.current = {operationId: operation.current, reason: reason.trim(), ...(action === 'withdraw' ? {} : {academicPeriodId: options!.period!.id, classId, sectionId})}; setConfirming(true); setFeedback(null);
  }
  async function save() {
    if (!accessToken || !selected || !detail || !action || !frozen.current || pending.current) return;
    pending.current = true; setBusy(true); setFeedback(null);
    try {
      await service.mutate(accessToken, selected, action, detail.current, frozen.current);
      setProfileEpoch(value => value + 1);
      setAction(null); setConfirming(false); frozen.current = null;
      setFeedback({kind: 'success', title: 'Enrollment updated', message: 'The server confirmed the change. Enrollment history has been retained.'});
      setOutcome(true);
      try {const fresh = await service.detail(accessToken, selected); setDetail(fresh); setHistoryOffset(0); await resource.refresh();}
      catch {setDetail(null); setFeedback({kind: 'success', title: 'Enrollment saved', message: 'The server confirmed the change. Refresh enrollment to reload the latest history.'});}
    } catch (error) {setFeedback({kind: 'error', title: 'Change not confirmed', message: errorMessage(error) + ' Retry uses the same operation identity. Refresh to inspect authoritative history.'});}
    finally {pending.current = false; setBusy(false);}
  }
  const actionTitle = (key: EnrollmentAction) => key === 'enroll' && detail && !detail.legacy ? 'Readmit' : actionLabels[key];
  const names = options?.classes.find(row => row.id === classId), targetSection = options?.sections.find(row => row.id === sectionId);
  const targetLabel = `${options?.period?.name ?? ''} / ${action === 'transfer' ? detail?.current?.class.name : names?.name ?? ''} / ${targetSection?.name ?? ''}`;
  return <DashboardShell keyboardShouldPersistTaps="handled"><ScreenHeading title="Students & Enrollment" subtitle="Permanent Student identity and academic membership history" />
    {admitting && accessToken ? <StudentAdmissionForm key={accessToken} token={accessToken} onClose={() => setAdmitting(false)} onCreated={(id, viewProfile = true) => {setAdmitting(false); resource.refresh(); if (viewProfile) openStudent(id);}} onAcademicSetup={() => {setAdmitting(false); navigation.navigate('AcademicSetup');}} /> : null}
    {feedback ? <AdminFeedback {...feedback} /> : null}
    {selected ? <>
      <Button title="Back to Students" variant="secondary" disabled={busy} onPress={() => {selection.current++; setSelected(null); setDetail(null); setAction(null); setFeedback(null);}} />
      {loadingDetail ? <ActivityIndicator accessibilityLabel="Loading enrollment" color={colors.primary} /> : null}
      <Button title="Refresh enrollment" variant="secondary" disabled={busy || loadingDetail} onPress={() => openStudent(selected, historyOffset)} />
      {detail && accessToken ? <StudentProfilePanel key={selected + accessToken + profileEpoch} token={accessToken} id={selected} onSaved={result => {setDetail(old => old ? {...old, student: {...old.student, ...result.student}} : old); resource.refresh();}} /> : null}
      {detail ? <><SectionCard title={detail.student.fullName}><Text style={styles.copy}>Admission: {detail.student.admissionNumber}</Text><Text style={styles.heading}>Current Enrollment</Text><Text style={styles.copy}>{label(detail.current)}</Text><StatusBadge status={detail.current ? 'paid' : 'unpaid'} label={detail.current?.status ?? (detail.legacy ? 'Legacy · setup required' : 'Not enrolled')} />{detail.legacyPlacement ? <Text style={styles.muted}>Legacy recorded placement: {detail.legacyPlacement.periodName ?? 'Period unverified'} / {detail.legacyPlacement.className} / {detail.legacyPlacement.sectionName}. Confirm placement before enrollment.</Text> : null}{detail.legacy ? <Text style={styles.muted}>No enrollment history has been recorded. Confirm the current placement explicitly; prior years will not be invented.</Text> : null}
        <View style={styles.actions}>{(Object.keys(actionLabels) as EnrollmentAction[]).filter(key => detail.actions[key]).map(key => <Button key={key} title={actionTitle(key)} variant={key === 'withdraw' ? 'danger' : 'secondary'} disabled={busy || loadingDetail} onPress={() => begin(key)} />)}</View>
      </SectionCard><SectionCard title="Enrollment History">{detail.history.length ? detail.history.map(row => <Card key={row.id}><Text style={styles.heading}>{label(row)}</Text><Text style={styles.copy}>{row.status} · {new Date(row.effectiveFrom).toLocaleDateString()} {row.effectiveTo ? 'to ' + new Date(row.effectiveTo).toLocaleDateString() : 'onward'}</Text><Text style={styles.muted}>{row.closedReason ?? row.reason}</Text></Card>) : <Text style={styles.muted}>No recorded enrollment history.</Text>}<View style={styles.actions}>{historyOffset > 0 ? <Button title="Newer history" disabled={busy} onPress={() => openStudent(selected, Math.max(0, historyOffset - 50))} /> : null}{detail.nextOffset !== null ? <Button title="Older history" disabled={busy} onPress={() => openStudent(selected, detail.nextOffset!)} /> : null}</View></SectionCard></> : null}
    </> : <>
      {user?.role === 'principal' && hasPermission(user.role, PERMISSIONS.STUDENTS_CREATE) ? <Button title="Add Student" onPress={() => setAdmitting(true)} /> : null}
      <SectionCard title="Find a Student"><AdminInput label="Search Students" value={search} onChangeText={value => {setSearch(value); setOffset(0);}} placeholder="Name or admission number" /><AdminSelect placeholder="All Students" helper="Filter by recorded enrollment status" label="Enrollment status" value={status} options={[{id: '', label: 'All Students'}, {id: 'active', label: 'Active enrollment'}, {id: 'not-enrolled', label: 'No active enrollment'}, {id: 'legacy', label: 'Legacy setup required'}]} onSelect={value => {setStatus(value); setOffset(0);}} /></SectionCard>
      {resource.loading ? <ActivityIndicator accessibilityLabel="Loading Students" color={colors.primary} /> : null}{resource.error ? <><AdminFeedback kind="error" title="Students unavailable" message={resource.error} /><Button title="Retry Students" onPress={resource.refresh} /></> : null}
      {!resource.loading && resource.data?.items.length === 0 ? <SectionCard title="No Students found"><Text style={styles.muted}>Try another name, admission number or enrollment filter.</Text></SectionCard> : resource.data?.items.map(row => <Card key={row.id}><Text style={styles.heading}>{row.fullName}</Text><Text style={styles.copy}>{row.admissionNumber} · {row.current?.status ?? (row.legacy ? 'Legacy setup required' : 'Not enrolled')}</Text><Text style={styles.muted}>{label(row.current)}</Text><Button title={'Enrollment for ' + row.fullName} variant="secondary" onPress={() => openStudent(row.id)} /></Card>)}
      <View style={styles.actions}>{offset > 0 ? <Button title="Previous Students" onPress={() => setOffset(Math.max(0, offset - 50))} /> : null}{resource.data?.nextOffset !== null && resource.data?.nextOffset !== undefined ? <Button title="More Students" onPress={() => setOffset(resource.data!.nextOffset!)} /> : null}</View>
    </>}
    <AdminDialog visible={outcome} title="Enrollment Completed" closeTitle="Done" onClose={() => setOutcome(false)}><AdminFeedback kind="success" title="Enrollment updated" message={feedback?.message ?? 'The server confirmed the change. Refresh to inspect the latest history.'} /></AdminDialog>
    <AdminDialog visible={!!action && !confirming} title={action ? actionTitle(action) : ''} confirmTitle="Review change" busy={busy || loadingDetail} onConfirm={preview} onClose={() => {if (!busy) setAction(null);}}>
      <Text style={styles.copy}>{detail?.student.fullName} · {detail?.student.admissionNumber}</Text><Text style={styles.muted}>Current: {label(detail?.current ?? null)}</Text>
      <Text style={styles.muted}>Section transfer keeps the same Class and Academic Period. Class movement within the same Period is not supported. Promotion uses a later Period after the prior Period closes.</Text>
      {action !== 'withdraw' ? <><Text style={styles.copy}>Target Period: {options?.period?.name ?? 'No active Academic Period available'}</Text>{action !== 'transfer' ? <AdminSelect placeholder="Choose a Class" helper="Classes in the active Academic Period" label="Target Class" value={classId} options={options?.classes.map(row => ({id: row.id, label: row.name + ' (' + row.code + ')'})) ?? []} onSelect={value => {setClassId(value); setSectionId(''); loadOptions(value, optionOffset);}} disabled={busy || loadingDetail} /> : null}<AdminSelect placeholder="Choose a Section" helper="Active Sections of the selected Class" label="Target Section" value={sectionId} options={options?.sections.filter(row => action !== 'transfer' || row.id !== detail?.current?.section.id).map(row => ({id: row.id, label: row.name + ' (' + row.code + ')'})) ?? []} onSelect={setSectionId} disabled={busy || loadingDetail} />{optionOffset > 0 ? <Button title="Previous target Classes" onPress={() => {setClassId(''); setSectionId(''); loadOptions(undefined, Math.max(0, optionOffset - 50));}} /> : null}{options?.nextOffset !== null && options?.nextOffset !== undefined ? <Button title="More target Classes" onPress={() => {setClassId(''); setSectionId(''); loadOptions(undefined, options.nextOffset!);}} /> : null}</> : <Text style={styles.muted}>Withdrawal closes membership. Student identity, historical work, results and dues remain intact.</Text>}
      <AdminInput label="Reason" value={reason} onChangeText={setReason} multiline />{feedback ? <AdminFeedback {...feedback} /> : null}{feedback?.kind === 'error' ? <Button title="Retry academic options" onPress={() => loadOptions(classId || undefined, optionOffset)} /> : null}
    </AdminDialog>
    <AdminDialog visible={confirming} title={action ? 'Confirm ' + actionTitle(action) : ''} confirmTitle="Confirm enrollment change" busy={busy} danger={action === 'withdraw'} onConfirm={save} onClose={() => {if (!busy) {setConfirming(false); setAction(null);}}}>
      <Text style={styles.heading}>{detail?.student.fullName} · {detail?.student.admissionNumber}</Text><Text style={styles.copy}>Current: {label(detail?.current ?? null)}</Text><Text style={styles.copy}>Target: {action === 'withdraw' ? 'Withdrawn · no current enrollment' : targetLabel}</Text><Text style={styles.muted}>Reason: {reason}</Text><Text style={styles.muted}>Prior enrollment remains in history. This decision does not calculate promotion eligibility or change results, fees or published work.</Text>{feedback ? <><AdminFeedback {...feedback} /><Button title="Refresh authoritative enrollment" disabled={busy} onPress={() => selected && openStudent(selected)} /></> : null}
    </AdminDialog>
    {!hasPermission(user?.role, PERMISSIONS.ENROLLMENT_VIEW) ? <AdminFeedback kind="error" title="Permission required" message="Student Enrollment is available to authorized administrators." /> : null}
  </DashboardShell>;
}
const styles = StyleSheet.create({copy: {...typography.body, color: colors.ink}, heading: {...typography.h3, color: colors.ink}, muted: {...typography.small, color: colors.muted, marginVertical: spacing.sm}, actions: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.md}});
