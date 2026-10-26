import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useAuth} from '../../context/AuthContext';
import {Button, Card, DashboardShell, ScreenHeading, SectionCard, StatusBadge} from '../../components/hiraDashboard';
import {AdminDateField, AdminDialog, AdminFeedback, AdminSelect, formStyles} from '../../components/hiraDashboard/AdminForm';
import {colors, radius, spacing, typography} from '../../theme/hiraDashboard';
import {academicSetupService as service, type AcademicPeriod, type CatalogRecord, type SetupAction, type SetupKind} from '../../services/admin/academicSetupService';
import {useTeacherResource} from '../teacher/useTeacherResource';
import {ApiError} from '../../services/api/apiClient';
import {hasPermission, PERMISSIONS} from '../../constants/permissions';

import ClassSubjectsPanel from './ClassSubjectsPanel';

type Tab = 'periods' | 'classes' | 'subjects' | 'rooms';
type Form = {category: string; kind: SetupKind; record?: AcademicPeriod | CatalogRecord; name: string; code: string; startDate: string; endDate: string};
type Confirmation = {kind: SetupKind; record: AcademicPeriod | CatalogRecord; action: SetupAction};
export const roomCategories = [{id:'classroom',label:'Classroom'}, {id:'science_lab',label:'Science Lab'}, {id:'computer_lab',label:'Computer Lab'}, {id:'library',label:'Library'}, {id:'hall',label:'Hall'}, {id:'other',label:'Other'}];
const labels = {rooms: 'Room', periods: 'Academic Period', classes: 'Class', sections: 'Section', subjects: 'Subject'};
const tabs: {key: Tab; title: string}[] = [{key: 'periods', title: 'Academic Period'}, {key: 'classes', title: 'Classes'}, {key: 'subjects', title: 'Subjects'}];
function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return 'You no longer have permission to manage this academic setup. Contact your school administrator.';
  if (error instanceof ApiError && error.status === 404) return 'This record or its parent is no longer available in your branch. Refresh the list.';
  return error instanceof Error ? error.message : 'Unable to contact the server. Please retry.';
}
export default function AcademicSetupScreen({roomsOnly = false}: {roomsOnly?: boolean}) {
  const {accessToken} = useAuth();
  return <AcademicSetupContent key={accessToken ?? 'signed-out'} roomsOnly={roomsOnly} />;
}
function AcademicSetupContent({roomsOnly}: {roomsOnly: boolean}) {
  const {user, accessToken} = useAuth();
  const governance = hasPermission(user?.role, PERMISSIONS.ACADEMIC_PERIODS_MANAGE);
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>(roomsOnly ? 'rooms' : governance ? 'periods' : 'classes');
  const [parent, setParent] = useState<CatalogRecord | null>(null);
  const [classView, setClassView] = useState<'sections' | 'subjects'>('sections');
  const [offset, setOffset] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState('');
  const [feedback, setFeedback] = useState<{kind: 'success' | 'error'; title: string; message: string} | null>(null);
  const mutation = useRef(false), alive = useRef(true), scope = useRef('');
  scope.current = `${accessToken}:${branchId}:${tab}:${parent?.id ?? ''}`;
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const kind: SetupKind = parent ? 'sections' : tab;
  const load = useCallback(async () => {
    if (!accessToken) throw new Error('Sign in to access Academic Setup.');
    const branches = await service.branches(accessToken);
    const selected = user?.role === 'principal' ? branches.items[0]?.id : branchId;
    if (!selected) return {branches: branches.items, periods: null, records: null};
    const query = user?.role === 'super_admin' ? {branchId: selected} : {};
    if (kind === 'rooms') {
      const records = await service.list(accessToken, 'rooms', {...query, q: search, offset});
      return {branches: branches.items, records, periods: null};
    }
    const periods = await service.periods(accessToken, {...query, offset: kind === 'periods' ? offset : 0});
    const records = kind === 'periods' || (parent && classView === 'subjects') ? null : await service.list(accessToken, kind, {...query, ...(parent ? {classId: parent.id} : {}), offset});
    return {branches: branches.items, periods, records};
  }, [accessToken, branchId, user?.role, kind, parent, offset, classView, search]);
  const resource = useTeacherResource(load, 'Academic setup is unavailable in your current branch.');
  const data = resource.data, current = data?.periods?.current;
  const selectedBranch = user?.role === 'principal' ? data?.branches[0]?.id : branchId;
  const writable = kind === 'rooms' || kind === 'subjects' || (kind === 'periods' ? governance : !!current && (!parent || (parent.isActive && !parent.legacy && parent.academicPeriodId === current.id)));
  const canManage = hasPermission(user?.role, kind === 'rooms' ? PERMISSIONS.ACADEMIC_ROOMS_MANAGE : kind === 'periods' ? PERMISSIONS.ACADEMIC_PERIODS_MANAGE : kind === 'classes' ? PERMISSIONS.ACADEMIC_CLASSES_MANAGE : kind === 'sections' ? PERMISSIONS.ACADEMIC_SECTIONS_MANAGE : PERMISSIONS.ACADEMIC_SUBJECTS_MANAGE);
  const changeTab = (next: Tab) => {setTab(next); setParent(null); setOffset(0); setFeedback(null); setForm(null); setConfirmation(null);};
  function edit(record?: AcademicPeriod | CatalogRecord) {
    setFeedback(null); setValidation('');
    setForm({kind, record, category: record && 'category' in record ? record.category ?? 'classroom' : 'classroom', name: record?.name ?? '', code: record && 'code' in record ? record.code ?? '' : '', startDate: record && 'startDate' in record ? record.startDate : '', endDate: record && 'endDate' in record ? record.endDate : ''});
  }
  async function mutate(operation: () => Promise<unknown>, success: string) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setFeedback(null);
    const started = scope.current;
    try {
      await operation();
      if (!alive.current || scope.current !== started) return;
      setForm(null); setConfirmation(null); setValidation('');
      setFeedback({kind: 'success', title: success, message: 'The server confirmed your change.'});
      await resource.refresh();
    } catch (error) {
      if (alive.current && scope.current === started) setFeedback({kind: 'error', title: 'Change not saved', message: errorMessage(error)});
    } finally {mutation.current = false; if (alive.current) setBusy(false);}
  }
  function save() {
    if (!form || !accessToken || !selectedBranch) return;
    const name = form.name.trim().replace(/\s+/g, ' '), code = form.code.trim().toUpperCase();
    const maxName = form.kind === 'rooms' ? 80 : form.kind === 'periods' || form.kind === 'subjects' ? 100 : 50;
    if (!name || name.length > maxName) {setValidation(`Enter a name of 1–${maxName} characters.`); return;}
    if (form.kind !== 'subjects' && !/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) {setValidation('Enter a code of 1–20 letters, numbers, hyphens or underscores.'); return;}
    if (form.kind === 'periods' && (!validDate(form.startDate) || !validDate(form.endDate) || form.startDate >= form.endDate)) {setValidation('Enter valid dates in YYYY-MM-DD format. The end date must be after the start date.'); return;}
    setValidation('');
    const query = user?.role === 'super_admin' ? {branchId: selectedBranch} : {};
    const body: Record<string, unknown> = {name};
    if (form.kind === 'rooms') body.category = form.category;
    if (form.kind !== 'subjects' && (form.kind !== 'periods' || !form.record)) body.code = code;
    if (form.kind === 'periods') Object.assign(body, {startDate: form.startDate, endDate: form.endDate});
    if (form.record) body.revision = form.record.revision;
    else if (form.kind === 'classes') body.academicPeriodId = current?.id;
    else if (form.kind === 'sections') body.classId = parent?.id;
    mutate(() => form.record ? service.update(accessToken, form.kind, query, form.record.id, body) : service.create(accessToken, form.kind, query, body), `${labels[form.kind]} saved`);
  }
  function confirm() {
    if (!confirmation || !accessToken || !selectedBranch) return;
    const query = user?.role === 'super_admin' ? {branchId: selectedBranch} : {};
    mutate(() => service.lifecycle(accessToken, confirmation.kind, query, confirmation.record.id, confirmation.action, confirmation.record.revision), roomsOnly ? 'Room updated' : 'Academic setup updated');
  }
  const records = kind === 'periods' ? data?.periods : data?.records;
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <DashboardShell refreshing={resource.loading} onRefresh={resource.refresh} keyboardShouldPersistTaps="handled">
      <ScreenHeading title={roomsOnly ? "Rooms" : "Academic Setup"} subtitle={roomsOnly ? "Manage physical school rooms and resources for timetable scheduling." : "Manage your branch’s academic catalog and teaching structure."} />
      {user?.role === 'super_admin' ? <AdminSelect label="Branch" value={branchId} options={data?.branches.map(branch => ({id: branch.id, label: branch.name, detail: branch.code})) ?? []} placeholder="Select a branch" helper="Choose the branch you are administering." disabled={busy} onSelect={id => {setBranchId(id); setSearch(''); setParent(null); setOffset(0); setForm(null); setConfirmation(null); setFeedback(null);}} /> : null}
      {!roomsOnly ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityLabel={item.title} accessibilityState={{selected: item.key === tab}} disabled={busy} onPress={() => changeTab(item.key)} style={[styles.tab, item.key === tab && styles.selected]}><Text style={[styles.tabText, item.key === tab && styles.selectedText]}>{item.title}</Text></Pressable>)}
      </ScrollView> : null}
      {roomsOnly ? <TextInput accessibilityLabel="Search Rooms" placeholder="Search Rooms by name or code" value={search} onChangeText={value => {setSearch(value); setOffset(0);}} editable={!busy} maxLength={100} style={formStyles.input} /> : null}
      {resource.loading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} accessibilityLabel="Loading academic setup" /><Text style={styles.muted}>{roomsOnly ? 'Loading Rooms…' : 'Loading academic setup…'}</Text></View> : null}
      {resource.error ? <><AdminFeedback kind="error" title={roomsOnly ? "Rooms unavailable" : "Academic setup unavailable"} message={resource.error} /><Button title={roomsOnly ? "Retry Rooms" : "Retry academic setup"} variant="secondary" onPress={resource.refresh} /></> : null}
      {feedback && !form && !confirmation ? <AdminFeedback {...feedback} /> : null}
      {data && (data.periods || (roomsOnly && data.records)) ? <>
        {!roomsOnly ? <SectionCard title={current ? current.name : 'No current Academic Period'}>
          {current ? <><StatusBadge status="paid" label="Active" /><Text style={styles.copy}>{current.startDate} to {current.endDate}</Text><Text style={styles.muted}>Period code: {current.code} · {data.periods?.branchName}</Text></> : <Text style={styles.copy}>A Super Admin must create and activate an Academic Period before new Classes and Sections can be added.</Text>}
          {!governance ? <Text style={styles.muted}>Academic Period governance is managed by Super Admin. Your access is read-only.</Text> : null}
        </SectionCard> : <Text style={styles.context}>Branch: {data.records?.branchName}. Referenced Rooms cannot be deactivated; timetable history is retained.</Text>}
        {parent ? <SectionCard title={`${classView === 'sections' ? 'Sections' : 'Subjects'} · ${parent.name}`}><Text style={styles.muted}>Class code: {parent.code} · {parent.periodName}</Text><Button title="Back to Classes" variant="secondary" disabled={busy} onPress={() => {setParent(null); setOffset(0); setFeedback(null);}} /></SectionCard> : null}
        {kind === 'subjects' ? <SectionCard title="Branch Subject catalog"><Text style={styles.copy}>Maintain the Subjects taught in this branch. Open a Class under Classes to manage its available Subjects.</Text></SectionCard> : null}
        {parent && classView === 'subjects' ? <ClassSubjectsPanel key={parent.id + ':' + selectedBranch} classId={parent.id} branchId={user?.role === 'super_admin' ? selectedBranch : undefined} /> : <>
        <View style={styles.listHeader}><Text style={styles.heading}>{roomsOnly ? 'Rooms' : parent ? 'Sections' : tabs.find(item => item.key === tab)?.title}</Text><Text style={styles.muted}>{records?.total ?? 0} records</Text></View>
        {canManage ? <Button title={`Create ${labels[kind]}`} disabled={!writable || busy || resource.loading} style={styles.create} onPress={() => {if (writable) edit();}} /> : null}
        {canManage && kind === 'classes' && !current ? <Text accessibilityRole="alert" style={styles.context}>Class creation requires an active Academic Period. {governance ? 'Open Academic Period, create a draft, then activate it.' : 'Ask your Super Admin to create and activate an Academic Period for this branch.'}</Text> : null}
        {!records?.items.length ? <Card><Text style={styles.heading}>{roomsOnly && search.trim() ? 'No matching rooms' : `No ${kind} yet`}</Text><Text style={styles.muted}>{roomsOnly && search.trim() ? 'Try another name or code.' : writable ? `Add the first ${labels[kind].toLowerCase()} to get started.` : 'No records are available in this context.'}</Text></Card> : records.items.map(record => {
          const period = kind === 'periods' ? record as AcademicPeriod : null, catalog = period ? null : record as CatalogRecord;
          const editable = period ? governance && period.status === 'draft' : !!catalog && !catalog.legacy && (kind === 'rooms' || kind === 'subjects' || (kind === 'classes' ? catalog.academicPeriodId === current?.id : writable));
          return <Card key={record.id} style={styles.record}>
            <View style={styles.row}><Text style={styles.recordName}>{record.name}</Text><StatusBadge status={period ? period.status === 'active' ? 'paid' : 'pending' : catalog?.isActive ? 'paid' : 'unpaid'} label={period ? period.status.charAt(0).toUpperCase() + period.status.slice(1) : catalog?.isActive ? 'Active' : 'Inactive'} /></View>
            {'code' in record && record.code ? <Text style={styles.muted}>Code: {record.code}</Text> : null}
            {catalog?.category ? <Text style={styles.muted}>Type: {roomCategories.find(item => item.id === catalog.category)?.label ?? catalog.category}</Text> : null}
            {period ? <Text style={styles.muted}>{period.startDate} to {period.endDate}</Text> : null}
            {catalog?.periodName ? <Text style={styles.muted}>Academic Period: {catalog.periodName}</Text> : null}
            {catalog?.legacy ? <Text style={styles.muted}>Legacy Class · read-only until an approved migration.</Text> : null}
            <View style={styles.actions}>
              {canManage && editable ? <Button title={`Edit ${record.name}`} variant="secondary" disabled={busy} onPress={() => edit(record)} /> : null}
              {kind === 'classes' && hasPermission(user?.role, PERMISSIONS.ACADEMIC_CLASS_SUBJECTS_VIEW) ? <Button title={'Subjects for ' + record.name} variant="secondary" disabled={busy} onPress={() => {setClassView('subjects'); setParent(record as CatalogRecord); setOffset(0); setFeedback(null);}} /> : null}
              {kind === 'classes' ? <Button title={`Sections for ${record.name}`} variant="secondary" disabled={busy} onPress={() => {setClassView('sections'); setParent(record as CatalogRecord); setOffset(0); setFeedback(null);}} /> : null}
              {canManage && editable && catalog ? <Button title={`${catalog.isActive ? 'Deactivate' : 'Reactivate'} ${record.name}`} variant={catalog.isActive ? 'danger' : 'secondary'} disabled={busy} onPress={() => {setFeedback(null); setConfirmation({kind, record, action: catalog.isActive ? 'deactivate' : 'reactivate'});}} /> : null}
              {period && governance ? (period.status === 'draft' ? ['activate', 'archive'] as const : period.status === 'active' ? ['close'] as const : period.status === 'closed' ? ['archive'] as const : []).map(action => <Button key={action} title={`${action.charAt(0).toUpperCase() + action.slice(1)} ${record.name}`} variant={action === 'activate' ? 'secondary' : 'danger'} disabled={busy} onPress={() => {setFeedback(null); setConfirmation({kind, record, action});}} />) : null}
            </View>
          </Card>;
        })}
        <View style={styles.actions}>{offset > 0 ? <Button title="Previous page" variant="secondary" disabled={busy} onPress={() => setOffset(Math.max(0, offset - 50))} /> : null}{records?.nextOffset !== null && records?.nextOffset !== undefined ? <Button title="Next page" variant="secondary" disabled={busy} onPress={() => setOffset(records.nextOffset!)} /> : null}</View>
        </>}
      </> : !resource.loading && !resource.error ? <SectionCard title="Choose a branch"><Text style={styles.copy}>Select a branch above to view its periods and academic catalog.</Text></SectionCard> : null}
      <AdminDialog visible={!!form} title={`${form?.record ? 'Edit' : 'Create'} ${form ? labels[form.kind] : ''}`} busy={busy} busyLabel="Saving academic setup" confirmTitle="Save changes" onConfirm={save} onClose={() => {if (!busy) {setForm(null); setFeedback(null);}}}>
        {form ? <>
          {form.kind === 'rooms' ? <AdminSelect label="Room Type" helper="Physical school resource category." value={form.category} options={roomCategories} placeholder="Select type" disabled={busy} onSelect={category => setForm({...form, category})} /> : null}
          {form.kind === 'classes' ? <Text style={styles.context}>Academic Period: {current?.name}</Text> : null}
          {form.kind === 'sections' ? <Text style={styles.context}>Class: {parent?.name}</Text> : null}
          <Text style={formStyles.label}>Name</Text><TextInput accessibilityLabel="Name" value={form.name} onChangeText={name => setForm({...form, name})} editable={!busy} maxLength={form.kind === 'rooms' ? 80 : form.kind === 'subjects' || form.kind === 'periods' ? 100 : 50} style={formStyles.input} placeholderTextColor={colors.muted} placeholder={`e.g. ${form.kind === 'rooms' ? 'Science Lab 1' : form.kind === 'classes' ? 'Grade 8' : form.kind === 'sections' ? 'Section A' : form.kind === 'subjects' ? 'Mathematics' : 'Academic Year 2026–27'}`} />
          {form.kind !== 'subjects' ? <View style={styles.field}><Text style={formStyles.label}>Code</Text><TextInput accessibilityLabel="Code" value={form.code} onChangeText={code => setForm({...form, code})} editable={!busy && !(form.kind === 'periods' && !!form.record)} maxLength={20} autoCapitalize="characters" autoCorrect={false} style={formStyles.input} /></View> : null}
          {form.kind === 'periods' ? <><AdminDateField label="First day of academic period" placeholder="2026-04-01" value={form.startDate} onChange={startDate => setForm({...form, startDate})} disabled={busy} helper="The date the academic period begins. Use year-month-day (YYYY-MM-DD)." /><AdminDateField label="Last day of academic period" placeholder="2027-03-31" value={form.endDate} onChange={endDate => setForm({...form, endDate})} disabled={busy} helper="The closing date of the academic period. Use YYYY-MM-DD and choose a date after the first day." /></> : null}
          {validation ? <Text accessibilityRole="alert" style={styles.validation}>{validation}</Text> : null}
          {feedback ? <AdminFeedback {...feedback} /> : null}
        </> : null}
      </AdminDialog>
      <AdminDialog visible={!!confirmation} title="Confirm academic setup change" confirmTitle="Confirm change" busy={busy} busyLabel="Updating academic setup" danger={confirmation?.action !== 'activate' && confirmation?.action !== 'reactivate'} onConfirm={confirm} onClose={() => {if (!busy) {setConfirmation(null); setFeedback(null);}}}>
        <Text style={styles.copy}>{confirmation ? `${confirmation.action.charAt(0).toUpperCase() + confirmation.action.slice(1)} ${confirmation.action === 'deactivate' ? confirmation.record.name : confirmation.record.name}?` : ''}</Text>
        <Text style={styles.context}>Records and history are retained. The server will reject changes that conflict with existing dependencies.</Text>
        {feedback ? <AdminFeedback {...feedback} /> : null}
      </AdminDialog>
    </DashboardShell>
  </KeyboardAvoidingView>;
}
function validDate(value: string) {
  // Validate calendar components without locale parsing or timezone conversion.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || match[0] !== value) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}
const styles = StyleSheet.create({
  flex: {flex: 1}, tabs: {gap: spacing.sm, marginBottom: spacing.lg},
  tab: {minHeight: 48, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.card},
  selected: {backgroundColor: colors.soft, borderColor: colors.primary}, tabText: {...typography.bodyStrong, color: colors.muted}, selectedText: {color: colors.primary},
  loading: {padding: spacing.xl, alignItems: 'center', gap: spacing.md},
  heading: {...typography.h3, color: colors.ink}, recordName: {...typography.h3, color: colors.ink, flex: 1}, copy: {...typography.body, color: colors.ink}, muted: {...typography.small, color: colors.muted, marginTop: spacing.xs},
  context: {...typography.small, color: colors.muted, marginVertical: spacing.md},
  listHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md},
  row: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md},
  record: {marginBottom: spacing.md}, create: {marginBottom: spacing.lg}, field: {marginTop: spacing.md, marginBottom: spacing.lg},
  validation: {...typography.small, color: colors.danger.text, marginTop: spacing.md},
});
