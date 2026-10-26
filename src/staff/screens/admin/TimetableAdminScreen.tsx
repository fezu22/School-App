import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  Button,
  Card,
  DashboardShell,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import {
  AdminDateField,
  AdminDialog,
  AdminFeedback,
  AdminSelect,
  formStyles as styles,
} from '../../components/hiraDashboard/AdminForm';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import {
  timetableAdminService as service,
  type TeacherEligibility,
  type TimetableRow,
  type TimetableVersion,
} from '../../services/admin/timetableAdminService';
import { useTeacherResource } from '../teacher/useTeacherResource';
import { ApiError } from '../../services/api/apiClient';

const classLoadError = (failure: unknown): never => {
  if (failure instanceof ApiError && [401, 403].includes(failure.status))
    throw new Error(
      'You are not authorized to view Classes in this branch. Sign in again or contact your administrator.'
    );
  throw new Error(
    'Classes could not be loaded. Check your connection and retry.'
  );
};
const layout = StyleSheet.create({ keyboard: { flex: 1 } });

export const timetableDays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number(s.slice(0, 4)) > 0 &&
  Number.isFinite(Date.parse(s + 'T12:00:00Z')) &&
  new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
export const validClockWindow = (start: string, end: string) =>
  [start, end].every((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)) && start < end;
const choices = (rows: { id: string; name: string }[]) =>
  rows.map((r) => ({ id: r.id, label: r.name }));
const safeCatalogError =
  (label: string) =>
  (failure: unknown): never => {
    if (failure instanceof ApiError && [401, 403].includes(failure.status))
      throw new Error(
        `You are not authorized to view ${label} in this branch. Sign in again or contact your administrator.`
      );
    throw new Error(
      `Unable to load ${label}. Refresh timetable to retry; review the selected academic context if it has changed.`
    );
  };

const teacherEligibilityMessages: Record<string, string> = {
  no_exact_assignment:
    'No teacher is assigned to this Class, Section and Subject. Assign a teacher to this exact combination in Teacher Assignments before scheduling this period.',
  inactive_assignment:
    'An exact teacher assignment exists, but it is inactive or revoked. Review Teacher Assignments.',
  future_assignment:
    'An exact teacher assignment exists, but its start date is in the future. Timetable scheduling requires a currently effective assignment; changing schedule dates does not change eligibility.',
  expired_assignment:
    'An exact teacher assignment exists, but its effective window has ended. Review Teacher Assignments.',
  teacher_unavailable:
    'A currently effective exact assignment exists, but its Teacher account is unavailable for this Branch. Review the Teacher account and Teacher Assignments.',
};
function TeacherEligibilityState({
  eligibility,
}: {
  eligibility?: TeacherEligibility;
}) {
  const reasons = eligibility?.reasons.length
    ? eligibility.reasons
    : ['unknown'];
  return (
    <>
      {reasons.map((reason) => (
        <Text key={reason} style={styles.copy}>
          {teacherEligibilityMessages[reason] ??
            'No eligible Teachers were returned. Review the exact Class, Section and Subject in Teacher Assignments, then refresh timetable.'}
        </Text>
      ))}
    </>
  );
}

function SelectorState({
  label,
  loading,
  error,
  count,
  eligible,
}: {
  label: string;
  loading: boolean;
  error: string | null;
  count: number;
  eligible: number;
}) {
  if (loading) return <Text style={styles.helper}>Loading {label}…</Text>;
  if (error)
    return (
      <AdminFeedback
        kind="error"
        title={`${label} unavailable`}
        message={error}
      />
    );
  if (!count)
    return (
      <Text style={styles.copy}>
        {`No ${label} configured for this academic context.`}
      </Text>
    );
  if (!eligible)
    return (
      <Text style={styles.copy}>
        {label} exist, but none are currently eligible. Review active academic
        records and Teacher Assignments.
      </Text>
    );
  return null;
}

export const timetableConflict = (rows: TimetableRow[]) => {
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i],
        b = rows[j];
      if (
        a.dayOfWeek === b.dayOfWeek &&
        a.startTime < b.endTime &&
        b.startTime < a.endTime &&
        (a.teacherId === b.teacherId ||
          a.sectionId === b.sectionId ||
          (a.roomId && b.roomId
            ? a.roomId === b.roomId
            : a.room.trim().toLowerCase() === b.room.trim().toLowerCase()))
      )
        return `Periods ${i + 1} and ${j + 1} overlap on ${
          timetableDays[a.dayOfWeek]
        } for the same ${
          a.teacherId === b.teacherId
            ? 'Teacher'
            : a.sectionId === b.sectionId
            ? 'Class/Section'
            : 'Room'
        }. Change the Day, times or assignment.`;
    }
  return '';
};

export default function TimetableAdminScreen() {
  const { user, accessToken } = useAuth();
  if (!accessToken || !hasPermission(user?.role, PERMISSIONS.TIMETABLE_MANAGE))
    return <Text>Timetable management is not permitted.</Text>;
  return (
    <TimetableBranches key={`${user?.id}:${accessToken}`} token={accessToken} />
  );
}
function TimetableBranches({ token }: { token: string }) {
  const [selected, setSelected] = useState('');
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [pendingBranch, setPendingBranch] = useState('');
  const editorState = useCallback((hasDraft: boolean, isSaving: boolean) => {
    setDirty(hasDraft);
    setSaving(isSaving);
  }, []);
  const resource = useTeacherResource(
    useCallback(() => service.options(token, {}), [token])
  );
  const branchId = selected || resource.data?.branchId || '';
  return (
    <KeyboardAvoidingView
      style={layout.keyboard}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <DashboardShell
        keyboardShouldPersistTaps="handled"
        refreshing={resource.loading}
        onRefresh={() => {
          if (!dirty && !saving) resource.refresh();
        }}
      >
        <ScreenHeading
          title="Timetable Scheduling"
          subtitle="Academic administration · weekly schedules and publication"
        />
        {resource.loading ? (
          <ActivityIndicator accessibilityLabel="Loading timetable branches" />
        ) : null}
        {resource.error ? (
          <AdminFeedback
            kind="error"
            title="Timetable unavailable"
            message={resource.error}
          />
        ) : null}
        <Button
          title="Refresh branches"
          onPress={resource.refresh}
          disabled={resource.loading || dirty || saving}
          variant="secondary"
        />
        {resource.data ? (
          <>
            <AdminSelect
              label="Branch"
              value={branchId}
              options={choices(resource.data.branches)}
              placeholder="Select a branch"
              helper="Principal scope is fixed to the authorized branch."
              disabled={resource.data.branchFixed || saving}
              onSelect={(id) => {
                if (id === branchId) return;
                if (dirty) setPendingBranch(id);
                else setSelected(id);
              }}
            />
            {branchId ? (
              <TimetableEditor
                key={branchId}
                token={token}
                branchId={branchId}
                onState={editorState}
              />
            ) : null}
          </>
        ) : null}
        <AdminDialog
          visible={!!pendingBranch}
          title="Discard draft and change Branch?"
          confirmTitle="Discard draft and change Branch"
          onClose={() => setPendingBranch('')}
          onConfirm={() => {
            setSelected(pendingBranch);
            setPendingBranch('');
          }}
        >
          <Text style={styles.copy}>
            The unsaved draft belongs to the current Branch. Changing Branch
            discards it.
          </Text>
        </AdminDialog>
      </DashboardShell>
    </KeyboardAvoidingView>
  );
}
function TimetableEditor({
  token,
  branchId,
  onState,
}: {
  token: string;
  branchId: string;
  onState: (dirty: boolean, busy: boolean) => void;
}) {
  const navigation =
    useNavigation<
      NavigationProp<{ AssignTeacher: undefined; Rooms: undefined }>
    >();
  const { user } = useAuth();
  const [teacherId, setTeacher] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [classId, setClass] = useState(''),
    [sectionId, setSection] = useState(''),
    [subjectId, setSubject] = useState('');
  const [day, setDay] = useState('1'),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [room, setRoom] = useState('');
  const [from, setFrom] = useState(''),
    [until, setUntil] = useState(''),
    [rows, setRows] = useState<TimetableRow[]>([]);
  const [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState<
    TimetableVersion | 'create' | null
  >(null);
  const [revisionTarget, setRevisionTarget] = useState<TimetableVersion | null>(
    null
  );
  const [expandedVersion, setExpandedVersion] = useState('');
  const lock = useRef(false),
    alive = useRef(true);
  const allowExit = useRef(false);
  useEffect(() => {
    onState(rows.length > 0, busy);
  }, [onState, rows.length, busy]);
  useEffect(() => {
    if (typeof navigation.addListener !== 'function') return;
    return navigation.addListener('beforeRemove', (event) => {
      if (allowExit.current || (!busy && !rows.length)) return;
      event.preventDefault();
      if (busy) return;
      Alert.alert(
        'Discard unsaved timetable?',
        'Leaving discards your unsaved draft.',
        [
          { text: 'Keep editing', style: 'cancel' },
          {
            text: 'Discard draft',
            style: 'destructive',
            onPress: () => {
              allowExit.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ]
      );
    });
  }, [navigation, busy, rows.length]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const options = useTeacherResource(
    useCallback(() => service.options(token, { branchId }), [token, branchId])
  );
  const list = useTeacherResource(
    useCallback(
      () => service.list(token, branchId, offset),
      [token, branchId, offset]
    )
  );
  const classes = useTeacherResource(
    useCallback(
      () => service.classes(token, branchId).catch(classLoadError),
      [token, branchId]
    )
  );
  const eligibleClasses = (classes.data ?? []).filter(
    (c) => c.isActive && !c.legacy && c.periodStatus === 'active'
  );
  const sections = useTeacherResource(
    useCallback(
      async () => ({
        classId,
        items: classId
          ? await service
              .sections(token, branchId, classId)
              .catch(safeCatalogError('Sections'))
          : [],
      }),
      [token, branchId, classId]
    )
  );
  const subjects = useTeacherResource(
    useCallback(
      async () => ({
        classId,
        items: classId
          ? await service
              .subjects(token, branchId, classId)
              .catch(safeCatalogError('Subjects'))
          : [],
      }),
      [token, branchId, classId]
    )
  );
  const rooms = useTeacherResource(
    useCallback(
      () => service.rooms(token, branchId).catch(safeCatalogError('Rooms')),
      [token, branchId]
    )
  );
  const activeRooms = rooms.data?.filter((row) => row.isActive) ?? [];
  const selectedRoom = activeRooms.find((row) => row.id === room);
  const teacherContext = `${classId}/${sectionId}/${subjectId}`;
  const teachers = useTeacherResource(
    useCallback(
      async () => ({
        context: teacherContext,
        ...(classId && sectionId && subjectId
          ? await service
              .eligibleTeachers(token, branchId, classId, sectionId, subjectId)
              .catch(safeCatalogError('Teachers'))
          : { items: [], eligibility: undefined }),
      }),
      [token, branchId, classId, sectionId, subjectId, teacherContext]
    )
  );
  const sectionRows =
    sections.data?.classId === classId ? sections.data.items : [];
  const subjectRows =
    subjects.data?.classId === classId ? subjects.data.items : [];
  const teacherRows =
    teachers.data?.context === teacherContext ? teachers.data.items : [];
  const eligibleSections = sectionRows.filter(
    (s) => s.isActive && s.classId === classId
  );
  const eligibleSubjects = subjectRows.filter(
    (s) => s.isActive && s.subject.isActive
  );
  const selectedClass = eligibleClasses.find((c) => c.id === classId);
  const selectedSection = eligibleSections.find((s) => s.id === sectionId);
  const selectedSubject = eligibleSubjects.find(
    (s) => s.subject.id === subjectId
  );
  const selectedTeacher = teacherRows.find((t) => t.id === teacherId);
  const staleSelection =
    (!classes.loading && !!classes.data && !!classId && !selectedClass) ||
    (!sections.loading &&
      sections.data?.classId === classId &&
      !!sectionId &&
      !selectedSection) ||
    (!subjects.loading &&
      subjects.data?.classId === classId &&
      !!subjectId &&
      !selectedSubject);
  const tuple =
    selectedClass &&
    selectedSection &&
    selectedSubject &&
    selectedTeacher &&
    !sections.loading &&
    !subjects.loading &&
    !teachers.loading &&
    !sections.error &&
    !subjects.error &&
    !teachers.error
      ? {
          className: selectedClass.name,
          sectionName: selectedSection.name,
          subjectName: selectedSubject.subject.name,
          academicPeriodName:
            selectedClass.periodName ??
            selectedClass.academicYear ??
            'Active Academic Period',
        }
      : undefined;
  const conflict = timetableConflict(rows);
  const invalidPeriod = rows.findIndex(
    (r) =>
      !validClockWindow(r.startTime, r.endTime) ||
      !Number.isInteger(r.dayOfWeek) ||
      r.dayOfWeek < 0 ||
      r.dayOfWeek > 6 ||
      !r.roomId ||
      (!!rooms.data && !activeRooms.some((item) => item.id === r.roomId)) ||
      !r.room.trim() ||
      r.room.trim().length > 120
  );
  const copyRevision = (version: TimetableVersion) => {
    setRows(version.periods);
    setFrom(version.effectiveFrom);
    setUntil(version.effectiveUntil);
    setEditingIndex(null);
    setSuccess(
      'Complete schedule copied into a new draft. Edit its periods and effective dates, then save and review before approval.'
    );
  };
  const disabled =
    busy ||
    options.loading ||
    list.loading ||
    classes.loading ||
    !options.data ||
    !list.data ||
    !classes.data;
  const datesValid =
    validDate(from) &&
    validDate(until) &&
    from < until &&
    Date.parse(until + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z') <=
      366 * 86400000;
  const save = async () => {
    if (
      lock.current ||
      !confirmation ||
      !list.data ||
      (confirmation === 'create' &&
        (!datesValid ||
          !rows.length ||
          conflict ||
          invalidPeriod >= 0 ||
          editingIndex !== null))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    const target = confirmation;
    try {
      if (target === 'create') {
        await service.create(token, {
          branchId,
          versionNumber: list.data.nextVersionNumber,
          effectiveFrom: from,
          effectiveUntil: until,
          periods: rows,
        });
        if (alive.current) {
          setRows([]);
          setOffset(0);
          setSuccess(
            'Draft saved. Review the schedule below, then approve it to enable Teacher occurrences.'
          );
        }
      } else {
        await service.approve(token, target.versionId);
        if (alive.current)
          setSuccess(
            'Schedule approved. The highest approved version effective on each school date produces eligible Teacher occurrences.'
          );
      }
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error ? failure.message : 'Timetable save failed.'
        );
    } finally {
      if (alive.current) {
        setConfirmation(null);
        // A rejected write may reflect changed authority/version/assignments too.
        await Promise.all([
          list.refresh(),
          options.refresh(),
          classes.refresh(),
          sections.refresh(),
          subjects.refresh(),
          teachers.refresh(),
          rooms.refresh(),
        ]);
        if (alive.current) setBusy(false);
      }
      lock.current = false;
    }
  };
  return (
    <>
      <Text style={styles.copy}>
        School timezone: {options.data?.timezone ?? 'Loading…'}. Use 24-hour
        HH:mm (13:00 = 1 PM). Dates are school civil dates. The end date is
        exclusive.
      </Text>
      <Text style={styles.helper}>
        Each version replaces the complete branch schedule for its effective
        dates. To change an existing schedule, use “Revise complete schedule”,
        adjust its periods, save a new draft and approve it. Existing
        substitutions belong to their original version.
      </Text>
      {options.loading || list.loading ? (
        <ActivityIndicator accessibilityLabel="Loading timetable" />
      ) : null}
      {error || options.error || list.error ? (
        <AdminFeedback
          kind="error"
          title="Timetable error"
          message={error || options.error || list.error || ''}
        />
      ) : null}
      {success ? (
        <AdminFeedback
          kind="success"
          title="Timetable saved"
          message={success}
        />
      ) : null}
      <Button
        title="Refresh timetable"
        disabled={busy}
        onPress={() => {
          list.refresh();
          options.refresh();
          classes.refresh();
          sections.refresh();
          subjects.refresh();
          teachers.refresh();
          rooms.refresh();
        }}
        variant="secondary"
      />
      <SectionCard title="1. Academic context">
        {staleSelection ? (
          <AdminFeedback
            kind="error"
            title="Academic context changed"
            message="A selected Class, Section or Subject is no longer eligible. Reselect the current academic context before adding a period."
          />
        ) : null}
        <Text style={styles.copy}>
          Academic Period:{' '}
          {selectedClass?.periodName ??
            selectedClass?.academicYear ??
            'Select a Class in the active Academic Period'}
        </Text>
        <Text style={styles.copy}>
          {list.data?.currentVersion
            ? 'Published today: version ' +
              list.data.currentVersion.versionNumber
            : 'No approved schedule is effective today.'}{' '}
          · New draft version {list.data?.nextVersionNumber ?? '…'}
        </Text>
        <AdminSelect
          label="Class"
          value={classId}
          options={eligibleClasses.map((c) => ({
            id: c.id,
            label: c.code ? c.name + ' — ' + c.code : c.name,
          }))}
          placeholder="Select a Class"
          helper="Search existing branch Classes by name or code."
          loading={classes.loading}
          disabled={busy || !!classes.error || !classes.data}
          onSelect={(id) => {
            setClass(id);
            setSection('');
            setSubject('');
            setTeacher('');
          }}
        />
        {classes.loading ? (
          <Text style={styles.helper}>Loading Classes…</Text>
        ) : classes.error ? (
          <AdminFeedback
            kind="error"
            title="Class list unavailable"
            message={classes.error}
          />
        ) : classes.data?.length === 0 ? (
          <Text style={styles.copy}>
            No Classes configured for this branch. Add Classes in Academic
            Setup.
          </Text>
        ) : !eligibleClasses.length ? (
          <Text style={styles.copy}>
            No schedulable Classes. Existing Classes are inactive, legacy, or
            outside an active Academic Period. Review Academic Setup.
          </Text>
        ) : null}
        <AdminSelect
          label="Section"
          value={sectionId}
          options={eligibleSections.map((s) => ({
            id: s.id,
            label: s.code ? s.name + ' — ' + s.code : s.name,
          }))}
          placeholder="Select a Section"
          helper="Sections come from the selected Class catalog, independently of Teacher assignments."
          loading={!!classId && sections.loading}
          disabled={busy || !selectedClass || !!sections.error}
          onSelect={(id) => {
            setSection(id);
            setSubject('');
            setTeacher('');
          }}
        />
        {classId ? (
          <SelectorState
            label="Sections"
            loading={sections.loading}
            error={sections.error}
            count={sectionRows.length}
            eligible={eligibleSections.length}
          />
        ) : null}
        <AdminSelect
          label="Subject"
          value={subjectId}
          options={
            selectedSection
              ? eligibleSubjects.map((s) => ({
                  id: s.subject.id,
                  label: s.subject.name,
                }))
              : []
          }
          placeholder="Select a Subject"
          helper="Active Class Subjects for this Class and Academic Period. Curriculum is Class-scoped; Section does not define a separate Subject catalog."
          loading={!!classId && subjects.loading}
          disabled={busy || !selectedSection || !!subjects.error}
          onSelect={(id) => {
            setSubject(id);
            setTeacher('');
          }}
        />
        {sectionId ? (
          <SelectorState
            label="Subjects"
            loading={subjects.loading}
            error={subjects.error}
            count={subjectRows.length}
            eligible={eligibleSubjects.length}
          />
        ) : null}
        <AdminSelect
          label="Teacher"
          value={teacherId}
          options={choices(teacherRows)}
          placeholder="Select an eligible Teacher"
          helper="Only Teachers with a currently valid exact Class / Section / Subject assignment are listed."
          loading={!!subjectId && teachers.loading}
          disabled={
            busy || !selectedSubject || !selectedSection || !!teachers.error
          }
          onSelect={setTeacher}
        />
        {subjectId ? (
          teachers.loading || teachers.error ? (
            <SelectorState
              label="Teachers"
              loading={teachers.loading}
              error={teachers.error}
              count={teacherRows.length}
              eligible={teacherRows.length}
            />
          ) : !teacherRows.length ? (
            <TeacherEligibilityState
              eligibility={
                teachers.data?.context === teacherContext
                  ? teachers.data.eligibility
                  : undefined
              }
            />
          ) : null
        ) : null}

        {subjectId &&
        !teachers.loading &&
        !teachers.error &&
        !teacherRows.length &&
        hasPermission(user?.role, PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE) ? (
          <Button
            title="Manage Teacher Assignments"
            variant="secondary"
            disabled={busy}
            onPress={() => navigation.navigate('AssignTeacher')}
          />
        ) : null}
        {subjectId && teachers.error ? (
          <Button
            title="Retry eligible Teachers"
            variant="secondary"
            disabled={busy || teachers.loading}
            onPress={() => {
              teachers.refresh();
            }}
          />
        ) : null}
        {teacherId && !teachers.loading && !selectedTeacher ? (
          <Text style={styles.copy}>
            The selected Teacher is no longer eligible. Choose a current
            assignment.
          </Text>
        ) : null}
      </SectionCard>
      <SectionCard title="2. Weekly period">
        <AdminSelect
          label="Day"
          value={day}
          options={timetableDays.map((label, i) => ({ id: String(i), label }))}
          placeholder="Select a Day"
          helper="Repeats weekly within the schedule's effective dates."
          disabled={disabled}
          onSelect={setDay}
        />
        {[
          { label: 'Start Time', value: start, change: setStart },
          { label: 'End Time', value: end, change: setEnd },
        ].map((field) => (
          <React.Fragment key={field.label}>
            <Text style={styles.label}>{field.label}</Text>
            <TextInput
              accessibilityLabel={field.label}
              value={field.value}
              onChangeText={field.change}
              editable={!disabled}
              autoCorrect={false}
              placeholder={field.label === 'Room' ? 'Room name' : 'HH:mm'}
              style={styles.input}
            />
          </React.Fragment>
        ))}
        <AdminSelect
          label="Room"
          value={room}
          options={activeRooms.map((item) => ({
            id: item.id,
            label: item.name,
            detail: [item.code, item.category?.replace(/_/g, ' ')]
              .filter(Boolean)
              .join(' · '),
          }))}
          placeholder="Select a physical Room"
          helper="Physical school resource, independent of Teacher selection."
          loading={rooms.loading}
          disabled={busy || rooms.loading || !!rooms.error}
          onSelect={setRoom}
        />
        {rooms.loading ? (
          <Text style={styles.helper}>Loading Rooms…</Text>
        ) : rooms.error ? (
          <>
            <AdminFeedback
              kind="error"
              title="Rooms unavailable"
              message={rooms.error}
            />
            <Button
              title="Retry Rooms"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                rooms.refresh();
              }}
            />
          </>
        ) : !rooms.data?.length ? (
          <Text style={styles.copy}>No rooms configured for this branch.</Text>
        ) : !activeRooms.length ? (
          <Text style={styles.copy}>
            No active rooms are configured for this branch.
          </Text>
        ) : null}
        {!!room && !rooms.loading && !rooms.error && !selectedRoom ? (
          <Text style={styles.copy}>
            The selected room is no longer available.
          </Text>
        ) : null}
        {!rooms.loading &&
        !rooms.error &&
        !activeRooms.length &&
        hasPermission(user?.role, PERMISSIONS.ACADEMIC_ROOMS_VIEW) ? (
          <Button
            title="Manage Rooms"
            variant="secondary"
            disabled={busy}
            onPress={() => navigation.navigate('Rooms')}
          />
        ) : null}
        {start && end && !validClockWindow(start, end) ? (
          <Text style={styles.copy}>
            Use HH:mm; End Time must be later on the same day. Overnight periods
            are not supported.
          </Text>
        ) : null}
        <Button
          title={
            editingIndex === null
              ? 'Add period to draft'
              : 'Update draft period'
          }
          disabled={
            disabled ||
            !tuple ||
            !validClockWindow(start, end) ||
            !selectedRoom ||
            rooms.loading ||
            !!rooms.error ||
            (rows.length >= 500 && editingIndex === null)
          }
          onPress={() => {
            if (tuple) {
              const nextRow = {
                teacherId,
                classId,
                sectionId,
                subjectId,
                dayOfWeek: Number(day),
                startTime: start,
                endTime: end,
                roomId: selectedRoom?.id,
                room: selectedRoom?.name ?? '',
                teacherName: selectedTeacher?.name ?? '',
                className: tuple.className,
                sectionName: tuple.sectionName,
                subjectName: tuple.subjectName,
              };
              setRows(
                editingIndex === null
                  ? [...rows, nextRow]
                  : rows.map((r, i) => (i === editingIndex ? nextRow : r))
              );
              setEditingIndex(null);
              setError('');
            }
          }}
        />
      </SectionCard>
      <SectionCard title="3. Complete schedule draft">
        {invalidPeriod >= 0 ? (
          <AdminFeedback
            kind="error"
            title="Invalid draft period"
            message={`Period ${
              invalidPeriod + 1
            } has an invalid Day, time window or Room. Legacy Room text must be replaced with a current Room selection before saving.`}
          />
        ) : null}
        {editingIndex !== null ? (
          <>
            <Text style={styles.copy}>
              Editing draft period {editingIndex + 1}. Update or cancel this
              edit before saving.
            </Text>
            <Button
              title="Cancel period edit"
              variant="secondary"
              disabled={busy}
              onPress={() => setEditingIndex(null)}
            />
          </>
        ) : null}
        {conflict ? (
          <AdminFeedback
            kind="error"
            title="Schedule conflict"
            message={conflict}
          />
        ) : null}
        <Text style={styles.copy}>
          New version: {list.data?.nextVersionNumber ?? '…'} · {rows.length}{' '}
          periods. Approval supersedes lower approved versions for these dates
          across the entire branch.
        </Text>
        <AdminDateField
          label="Effective From"
          value={from}
          onChange={setFrom}
          disabled={busy}
          helper="YYYY-MM-DD, inclusive school date."
          error={
            from && !validDate(from)
              ? 'Enter a valid YYYY-MM-DD school date.'
              : undefined
          }
        />
        <AdminDateField
          label="Effective Until"
          value={until}
          onChange={setUntil}
          disabled={busy}
          helper="YYYY-MM-DD, exclusive school date; at most 366 days after From."
          error={
            until && !datesValid
              ? 'Use a valid end date after From, at most 366 days later.'
              : undefined
          }
        />
        {rows.map((r, i) => (
          <Card key={i}>
            <Text style={styles.copy}>
              {timetableDays[r.dayOfWeek]} {r.startTime}–{r.endTime} · {r.room}
              {'\n'}
              {r.className} / {r.sectionName} / {r.subjectName} ·{' '}
              {r.teacherName}
            </Text>
            <Button
              title={`Edit draft period ${i + 1}`}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setEditingIndex(i);
                setClass(r.classId);
                setSection(r.sectionId);
                setSubject(r.subjectId);
                setTeacher(r.teacherId);
                setDay(String(r.dayOfWeek));
                setStart(r.startTime);
                setEnd(r.endTime);
                setRoom(r.roomId ?? '');
              }}
            />
            <Button
              title={`Remove draft period ${i + 1}`}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setRows(rows.filter((_, n) => n !== i));
                setEditingIndex(null);
              }}
            />
          </Card>
        ))}
        <Button
          title="Save timetable draft"
          disabled={
            disabled ||
            !datesValid ||
            !rows.length ||
            !!conflict ||
            invalidPeriod >= 0 ||
            editingIndex !== null
          }
          onPress={() => setConfirmation('create')}
        />
      </SectionCard>
      <SectionCard title="Saved schedules">
        {list.data && !list.data.items.length ? (
          <Text style={styles.copy}>
            No timetable versions. Add periods and save a draft above.
          </Text>
        ) : null}
        {list.data?.items.map((v) => (
          <Card key={v.versionId}>
            <Text style={styles.heading}>
              Version {v.versionNumber} · {v.status}
              {list.data?.currentVersion?.versionId === v.versionId
                ? ' · Effective today'
                : ''}
            </Text>
            <Text style={styles.copy}>
              {v.effectiveFrom} to {v.effectiveUntil} (end exclusive)
            </Text>
            <Button
              title={`Review schedule ${v.versionNumber}`}
              variant="secondary"
              disabled={busy}
              onPress={() =>
                setExpandedVersion(
                  expandedVersion === v.versionId ? '' : v.versionId
                )
              }
            />
            <Text style={styles.helper}>
              {v.periods.length} periods · Open the complete schedule to review
              before approval.
            </Text>
            {expandedVersion === v.versionId
              ? v.periods.map((r, i) => (
                  <Text key={r.periodId ?? i} style={styles.copy}>
                    {timetableDays[r.dayOfWeek]} {r.startTime}–{r.endTime} ·{' '}
                    {r.room}
                    {'\n'}
                    {r.className} / {r.sectionName} / {r.subjectName} ·{' '}
                    {r.teacherName}
                  </Text>
                ))
              : null}
            <Button
              title={`Revise complete schedule ${v.versionNumber}`}
              disabled={disabled}
              variant="secondary"
              onPress={() => {
                if (rows.length) setRevisionTarget(v);
                else copyRevision(v);
              }}
            />
            {v.status === 'draft' ? (
              <Button
                title={`Approve schedule ${v.versionNumber}`}
                disabled={disabled || expandedVersion !== v.versionId}
                onPress={() => {
                  if (expandedVersion === v.versionId) setConfirmation(v);
                }}
              />
            ) : null}
          </Card>
        ))}
        {list.data?.nextOffset != null ? (
          <Button
            title="Older schedules"
            disabled={disabled}
            variant="secondary"
            onPress={() => setOffset(list.data!.nextOffset!)}
          />
        ) : null}
        {offset > 0 ? (
          <Button
            title="Latest schedules"
            disabled={busy}
            variant="secondary"
            onPress={() => setOffset(0)}
          />
        ) : null}
      </SectionCard>
      <Button
        title="Back"
        disabled={busy}
        variant="secondary"
        onPress={() => navigation.goBack()}
      />
      <AdminDialog
        visible={!!revisionTarget}
        title="Replace unsaved draft?"
        confirmTitle="Copy complete schedule"
        onClose={() => setRevisionTarget(null)}
        onConfirm={() => {
          if (revisionTarget) copyRevision(revisionTarget);
          setRevisionTarget(null);
        }}
      >
        <Text style={styles.copy}>
          This replaces the periods and dates in your unsaved draft with the
          complete selected version. Published schedules remain unchanged until
          a new version is saved and approved.
        </Text>
      </AdminDialog>
      <AdminDialog
        visible={!!confirmation}
        title={
          confirmation === 'create'
            ? 'Save complete branch schedule?'
            : 'Approve complete branch schedule?'
        }
        confirmTitle={
          confirmation === 'create' ? 'Confirm Save Draft' : 'Confirm Approval'
        }
        busy={busy}
        onClose={() => setConfirmation(null)}
        onConfirm={save}
        busyLabel="Saving timetable"
      >
        <Text style={styles.copy}>
          {confirmation === 'create'
            ? `${rows.length} periods · ${from} to ${until}. Drafts do not create Teacher occurrences until approved.`
            : `Approve version ${confirmation?.versionNumber}: ${confirmation?.periods.length} periods, ${confirmation?.effectiveFrom} to ${confirmation?.effectiveUntil} (end exclusive). This publishes the entire version. The highest approved version wins on each effective date. Unsaved draft changes are not included. Substitutions from superseded versions will no longer apply.`}
        </Text>
      </AdminDialog>
    </>
  );
}
