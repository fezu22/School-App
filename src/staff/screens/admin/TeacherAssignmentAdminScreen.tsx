import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  Card,
  DashboardShell,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import {
  AdminDateField,
  AdminDialog,
  AdminFeedback,
  AdminSelect,
  formStyles as styles,
} from '../../components/hiraDashboard/AdminForm';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/hiraDashboard';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { ApiError } from '../../services/api/apiClient';
import {
  teacherAssignmentService as service,
  type AssignmentOptions,
  type AssignmentHistory,
  type ManagedAssignment,
} from '../../services/admin/teacherAssignmentService';

export const assignmentInstant = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 1)
    return null;
  const value = new Date(date + 'T00:00:00.000Z');
  return Number.isFinite(value.getTime()) &&
    value.toISOString().slice(0, 10) === date
    ? value.toISOString()
    : null;
};
const dateLabel = (date: string) =>
  new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    if (
      error.status === 403 &&
      error.message.includes('Teacher is not eligible')
    )
      return 'The selected Teacher is no longer active or eligible. Review the refreshed Teacher context.';
    if (error.status === 403 && error.message.includes('branch'))
      return 'The selected branch is no longer active. Review your current branch and academic scope.';
    if (error.status === 409 && error.message.includes('already revoked'))
      return 'This assignment was already revoked. Review current assignments.';
    if (error.status === 401 || error.status === 403)
      return 'You no longer have permission to create or revoke this assignment. Sign in again or contact your school administrator.';
    if (error.status === 404)
      return 'The selected Teacher or academic scope is no longer available. Review the refreshed options.';
    if (error.status === 409)
      return 'This assignment conflicts with an existing active tuple. Review current assignments and revoke it before replacement.';
  }
  return error instanceof Error
    ? error.message
    : 'Unable to save. Your selections have been retained; check your connection and retry.';
};
type Props = {
  route: { params?: { teacherId?: string } };
  navigation: { goBack: () => void };
};
export default function TeacherAssignmentAdminScreen({
  route,
  navigation,
}: Props) {
  const { user, accessToken } = useAuth();
  const allowed =
    (user?.role === 'super_admin' || user?.role === 'principal') &&
    hasPermission(user.role, PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE);
  const [teacherId, setTeacher] = useState(route.params?.teacherId ?? ''),
    [branchId, setBranch] = useState(''),
    [classId, setClass] = useState(''),
    [sectionId, setSection] = useState(''),
    [subjectId, setSubject] = useState(''),
    [from, setFrom] = useState(''),
    [until, setUntil] = useState('');
  const [searchText, setSearchText] = useState(''),
    [search, setSearch] = useState(''),
    [teacherOffset, setTeacherOffset] = useState(0),
    [historyOffset, setHistoryOffset] = useState(0);
  const [options, setOptions] = useState<AssignmentOptions | null>(null),
    [history, setHistory] = useState<AssignmentHistory | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{
      summary: string;
      row?: ManagedAssignment;
    } | null>(null),
    [success, setSuccess] = useState<{ title: string; message: string } | null>(
      null,
    );
  const alive = useRef(true),
    focused = useRef(false),
    lastIntent = useRef(route.params?.teacherId);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const generation = useRef(0),
    lifecycle = useRef(0),
    inFlight = useRef(false);
  const selections = useRef({ sectionId, subjectId });
  selections.current = { sectionId, subjectId };
  const refresh = useCallback(async () => {
    if (inFlight.current || !allowed || !accessToken) return;
    const id = ++generation.current;
    setLoading(true);
    setConfirmation(null);
    try {
      const [data, rows] = await Promise.all([
        service.options(accessToken, {
          teacherId: teacherId || undefined,
          branchId: branchId || undefined,
          classId: classId || undefined,
          search,
          offset: teacherOffset,
        }),
        teacherId
          ? service.history(accessToken, teacherId, historyOffset)
          : null,
      ]);
      if (id !== generation.current) return;
      setOptions(data);
      setHistory(rows);
      setBranch(data.branchId ?? '');
      const staleClass = classId && !data.classes.some(c => c.id === classId);
      const staleSection =
          selections.current.sectionId &&
          !data.sections.some(s => s.id === selections.current.sectionId),
        staleSubject =
          selections.current.subjectId &&
          !data.subjects.some(s => s.id === selections.current.subjectId);
      if (staleClass) setClass('');
      if (staleClass || staleSection) setSection('');
      if (staleClass || staleSection || staleSubject) setSubject('');
      if (staleClass || staleSection || staleSubject)
        setError(
          'Some academic choices changed. Review the refreshed class, section and subject options.',
        );
    } catch (e) {
      if (id === generation.current) {
        if (e instanceof ApiError && e.status === 404 && classId) {
          setClass('');
          setSection('');
          setSubject('');
        } else {
          setOptions(null);
        }
        setHistory(null);
        setError(errorMessage(e));
      }
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [
    allowed,
    accessToken,
    teacherId,
    branchId,
    classId,
    search,
    teacherOffset,
    historyOffset,
  ]);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      refresh();
      return () => {
        focused.current = false;
        generation.current++;
        lifecycle.current++;
      };
    }, [refresh]),
  );
  const resetAcademic = useCallback(() => {
    setClass('');
    setSection('');
    setSubject('');
    setOptions(null);
    setSuccess(null);
    setError('');
  }, []);
  const selectTeacher = (id: string) => {
    generation.current++;
    setTeacher(id);
    setBranch('');
    resetAcademic();
    setHistory(null);
    setHistoryOffset(0);
  };
  useEffect(() => {
    if (lastIntent.current !== route.params?.teacherId) {
      lastIntent.current = route.params?.teacherId;
      lifecycle.current++;
      generation.current++;
      setTeacher(route.params?.teacherId ?? '');
      setBranch('');
      resetAcademic();
      setHistory(null);
      setHistoryOffset(0);
      setFrom('');
      setUntil('');
    }
  }, [route.params?.teacherId, resetAcademic]);
  const fromInstant = assignmentInstant(from),
    untilInstant = until ? assignmentInstant(until) : undefined;
  const fromError =
    from && !fromInstant ? 'Enter a real date as YYYY-MM-DD.' : undefined;
  const untilError =
    until && (!untilInstant || (!!fromInstant && untilInstant <= fromInstant))
      ? 'Valid Until must be a real date after Valid From.'
      : undefined;
  const teacher = options?.selectedTeacher;
  const branch = options?.branches.find(b => b.id === branchId);
  const ready =
    !loading &&
    !busy &&
    !!teacher &&
    teacher.isActive &&
    teacher.teacherId === teacherId &&
    teacher.branchId === branchId &&
    !!options?.classes.some(c => c.id === classId) &&
    !!options?.sections.some(s => s.id === sectionId) &&
    !!options?.subjects.some(s => s.id === subjectId) &&
    !!fromInstant &&
    !untilError;
  const summary =
    teacher && branch
      ? 'Teacher: ' +
        teacher.fullName +
        '\nBranch: ' +
        branch.name +
        '\nClass: ' +
        options?.classes.find(c => c.id === classId)?.name +
        '\nSection: ' +
        options?.sections.find(s => s.id === sectionId)?.name +
        '\nSubject: ' +
        options?.subjects.find(s => s.id === subjectId)?.name +
        '\nEffective: ' +
        (fromInstant ? dateLabel(fromInstant) : '') +
        ' to ' +
        (untilInstant ? dateLabel(untilInstant) : 'Ongoing') +
        ' (00:00 UTC)'
      : '';
  const save = async () => {
    if (inFlight.current || !confirmation || !accessToken || !allowed) return;
    if (!confirmation.row && !ready) return;
    const life = lifecycle.current,
      current = confirmation;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = current.row
        ? await service.revoke(accessToken, current.row.assignmentId)
        : await service.create(accessToken, {
            teacherId,
            classId,
            sectionId,
            subjectId,
            validFrom: fromInstant!,
            ...(untilInstant ? { validUntil: untilInstant } : {}),
          });
      if (life !== lifecycle.current) return;
      if (
        !response.success ||
        !response.data?.assignmentId ||
        response.data.isActive !== !current.row ||
        (current.row && response.data.assignmentId !== current.row.assignmentId)
      )
        throw new Error(
          'The server did not confirm the assignment change. Review current assignments before retrying.',
        );
      setSuccess(
        current.row
          ? {
              title: 'Teacher assignment revoked.',
              message:
                'This scope is removed on subsequent authorized requests. Assignment history is retained.',
            }
          : {
              title: 'Teacher assignment created successfully.',
              message: `${current.summary}\nAcademic scope is available during this period while the Teacher and academic records remain active. Timetable and attendance follow their own occurrence rules.`,
            },
      );
      setConfirmation(null);
      if (!current.row) setSubject('');
    } catch (e) {
      if (life === lifecycle.current) {
        setConfirmation(null);
        setError(errorMessage(e));
      }
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setBusy(false);
        if (focused.current) await latestRefresh.current();
      }
    }
  };
  if (!allowed)
    return (
      <DashboardShell>
        <ScreenHeading
          title="Access restricted"
          subtitle="Teacher assignment management requires authorized school administration."
        />
      </DashboardShell>
    );
  const teacherOptions = options?.teachers.items ?? [];
  const choices =
    teacher && !teacherOptions.some(t => t.teacherId === teacher.teacherId)
      ? [teacher, ...teacherOptions]
      : teacherOptions;
  return (
    <DashboardShell
      refreshing={loading && !!options}
      onRefresh={() => {
        refresh();
      }}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeading
        title="Assign Teacher"
        subtitle="Assign a Teacher to a specific class, section and subject for an effective period."
      />
      <Text style={styles.helper}>
        {user?.role === 'principal'
          ? 'Principal - current branch only'
          : 'Super Admin - school administration'}
      </Text>
      {success ? (
        <>
          <AdminFeedback kind="success" {...success} />
          <Button
            title="Assign Another Subject"
            onPress={() => {
              setSuccess(null);
              setSubject('');
            }}
            variant="secondary"
          />
          <Button
            title="Done"
            onPress={() => navigation.goBack()}
            style={styles.action}
          />
        </>
      ) : null}
      {error ? (
        <>
          <AdminFeedback
            kind="error"
            title="Assignment needs review"
            message={error}
          />
          <Button
            title="Refresh options"
            onPress={() => {
              setError('');
              refresh();
            }}
            variant="secondary"
          />
          <Button
            title="Review Teacher selection"
            onPress={() => selectTeacher('')}
            variant="secondary"
            style={styles.action}
          />
        </>
      ) : null}
      <SectionCard title="1. Teacher">
        <Text style={styles.label}>Find a Teacher</Text>
        <TextInput
          accessibilityLabel="Find a Teacher"
          maxLength={254}
          placeholder="Search by name or login email"
          placeholderTextColor={colors.muted}
          value={searchText}
          onChangeText={setSearchText}
          editable={!busy}
          style={styles.input}
          autoCorrect={false}
        />
        <Button
          title="Search Teachers"
          variant="secondary"
          disabled={busy || loading}
          onPress={() => {
            setSearch(searchText.trim());
            setTeacherOffset(0);
          }}
          style={styles.action}
        />
        {options && !loading && options.teachers.total === 0 ? (
          <Card>
            <Text style={styles.label}>No eligible Teachers</Text>
            <Text style={styles.copy}>
              No active Teachers match this branch or search. Adjust the search
              or ask a Super Admin to provision an account.
            </Text>
          </Card>
        ) : null}
        <AdminSelect
          label="Teacher"
          value={teacherId}
          options={choices.map(t => ({
            id: t.teacherId,
            label: t.fullName,
            detail: t.email,
          }))}
          placeholder="Select a Teacher"
          helper="Only eligible active Teachers in your allowed scope are listed."
          loading={loading}
          disabled={busy}
          onSelect={selectTeacher}
        />
        {teacherId && user?.role === 'super_admin' ? (
          <Button
            title="Change Teacher or branch"
            variant="secondary"
            disabled={busy || loading}
            onPress={() => selectTeacher('')}
            style={styles.action}
          />
        ) : null}
        {options?.teachers.nextOffset !== null &&
        options?.teachers.nextOffset !== undefined ? (
          <Button
            title="Next Teachers"
            variant="secondary"
            disabled={busy || loading}
            onPress={() => setTeacherOffset(options.teachers.nextOffset!)}
          />
        ) : null}
        {teacherOffset > 0 ? (
          <Button
            title="First Teachers"
            variant="secondary"
            disabled={busy || loading}
            onPress={() => setTeacherOffset(0)}
          />
        ) : null}
        {teacher ? (
          <Card>
            <Text style={styles.heading}>{teacher.fullName}</Text>
            <Text style={styles.copy}>{teacher.email}</Text>
            <Text style={styles.helper}>{branch?.name ?? 'Review branch'}</Text>
            <StatusBadge
              status={teacher.isActive ? 'paid' : 'unpaid'}
              label={teacher.isActive ? 'Active Teacher' : 'Inactive Teacher'}
            />
          </Card>
        ) : (
          <Text style={styles.helper}>
            {loading
              ? 'Loading Teacher context...'
              : 'Choose a Teacher to see their branch and current assignments.'}
          </Text>
        )}
      </SectionCard>
      <SectionCard title="2. Academic Scope">
        <AdminSelect
          label="Branch"
          value={branchId}
          options={(options?.branches ?? []).map(b => ({
            id: b.id,
            label: b.name,
            detail: b.code,
          }))}
          placeholder="Select an active branch"
          helper={
            options?.branchFixed
              ? 'Your current authorized branch is fixed.'
              : teacherId
              ? 'Branch follows the selected Teacher. Choose another Teacher to change branch.'
              : 'Choose a branch to filter eligible Teachers.'
          }
          loading={loading}
          disabled={busy || options?.branchFixed || !!teacherId}
          onSelect={id => {
            if (teacherId || options?.branchFixed) return;
            setBranch(id);
            resetAcademic();
            setTeacherOffset(0);
            setHistory(null);
            setHistoryOffset(0);
          }}
        />
        <AdminSelect
          label="Class"
          value={classId}
          options={(options?.classes ?? []).map(c => ({
            id: c.id,
            label: c.name,
          }))}
          placeholder="Select a class"
          helper="Choose an active class in the selected branch."
          loading={loading}
          disabled={busy || !teacher?.isActive || !branchId}
          onSelect={id => {
            setClass(id);
            setSection('');
            setSubject('');
            setLoading(true);
            setSuccess(null);
            setError('');
          }}
        />
        <AdminSelect
          label="Section"
          value={sectionId}
          options={(options?.sections ?? []).map(s => ({
            id: s.id,
            label: s.name,
          }))}
          placeholder="Select a section"
          helper="Only sections belonging to the selected class are available."
          loading={loading}
          disabled={busy || !classId || !teacher?.isActive}
          onSelect={id => {
            setSection(id);
            setSubject('');
            setError('');
          }}
        />
        <AdminSelect
          label="Subject"
          value={subjectId}
          options={(options?.subjects ?? []).map(s => ({
            id: s.id,
            label: s.name,
          }))}
          placeholder="Select a subject"
          helper="Subjects come from this branch's catalogue. This assignment grants only the selected tuple."
          loading={loading}
          disabled={busy || !sectionId || !teacher?.isActive}
          onSelect={id => {
            setSubject(id);
            setError('');
          }}
        />
      </SectionCard>
      <SectionCard title="3. Effective Period">
        <AdminDateField
          label="Valid From (required)"
          value={from}
          onChange={setFrom}
          disabled={busy}
          error={fromError}
          helper="Determines when this assignment becomes active. Dates begin at 00:00 UTC."
        />
        <AdminDateField
          label="Valid Until (optional)"
          value={until}
          onChange={setUntil}
          disabled={busy}
          error={untilError}
          helper="Leave empty for an ongoing assignment. Access ends at 00:00 UTC on the end date."
        />
      </SectionCard>
      <Button
        title={busy ? 'Saving assignment...' : 'Create Assignment'}
        disabled={!ready}
        onPress={() => setConfirmation({ summary })}
      />
      <Button
        title="Back"
        variant="secondary"
        disabled={busy}
        onPress={() => navigation.goBack()}
        style={styles.action}
      />
      {teacherId ? (
        <SectionCard title="Current Assignments">
          <Text style={styles.helper}>
            Tuple and dates are immutable. Revoke and replace to change an
            assignment; expired tuples still reserve their slot until revoked.
          </Text>
          {loading ? (
            <ActivityIndicator accessibilityLabel="Loading assignments" />
          ) : !history ? (
            <Text style={styles.copy}>
              Assignments unavailable. Refresh to review current authority.
            </Text>
          ) : !history.items.length ? (
            <Text style={styles.copy}>No assignments for this Teacher.</Text>
          ) : (
            history.items.map(row => (
              <Card key={row.assignmentId}>
                <Text style={styles.label}>
                  {row.className} - Section {row.sectionName}
                </Text>
                <Text style={styles.copy}>{row.subjectName}</Text>
                <Text style={styles.helper}>
                  {dateLabel(row.validFrom)} to{' '}
                  {row.validUntil ? dateLabel(row.validUntil) : 'Ongoing'} (UTC)
                </Text>
                <StatusBadge
                  status={
                    row.status === 'active'
                      ? 'paid'
                      : row.status === 'upcoming'
                      ? 'pending'
                      : 'unpaid'
                  }
                  label={row.status}
                />
                {row.canRevoke ? (
                  <Button
                    title={`Revoke ${row.className} / ${row.sectionName} / ${row.subjectName}`}
                    variant="danger"
                    disabled={busy || loading}
                    onPress={() =>
                      setConfirmation({
                        row,
                        summary: `${
                          teacher?.fullName ?? history.teacher.fullName
                        }\n${row.className} - ${row.sectionName} - ${
                          row.subjectName
                        }\nThe Teacher will lose this academic scope on subsequent authorized requests. History will be retained.`,
                      })
                    }
                    style={styles.action}
                  />
                ) : null}
              </Card>
            ))
          )}
          {history?.nextOffset !== null && history?.nextOffset !== undefined ? (
            <Button
              title="Next assignments"
              disabled={busy || loading}
              variant="secondary"
              onPress={() => setHistoryOffset(history.nextOffset!)}
            />
          ) : null}
          {historyOffset > 0 ? (
            <Button
              title="First assignments"
              disabled={busy || loading}
              variant="secondary"
              onPress={() => setHistoryOffset(0)}
            />
          ) : null}
        </SectionCard>
      ) : null}
      <AdminDialog
        visible={!!confirmation}
        title={
          confirmation?.row
            ? 'Revoke this assignment?'
            : 'Confirm Teacher Assignment'
        }
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          save();
        }}
        confirmTitle={
          confirmation?.row ? 'Confirm Revoke' : 'Confirm Assignment'
        }
        busy={busy}
        danger={!!confirmation?.row}
      >
        <Text style={styles.copy}>{confirmation?.summary}</Text>
      </AdminDialog>
    </DashboardShell>
  );
}
