import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  attendanceService,
  attendanceOperationId,
  type AttendanceDetail,
  type AttendanceMark,
  type AttendanceStatus,
  type AttendanceWrite,
} from '../../services/teacher/attendanceService';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import {
  Button,
  Card,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import { PeriodSummary, TimetableState, timetableStyles } from './timetableUi';
const statuses = ['present', 'absent', 'late', 'leave'] as const;
const initialMarks = (detail: AttendanceDetail) =>
  detail.students.map(({ studentId, status }) => ({ studentId, status }));
export default function TeacherAttendanceScreen({
  route,
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherAttendance'>) {
  const { accessToken } = useAuth(),
    { periodId, date } = route.params;
  const [data, setData] = useState<AttendanceDetail | null>(null),
    [marks, setMarks] = useState<AttendanceMark[]>([]),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [review, setReview] = useState<AttendanceDetail | null>(null),
    [blocked, setBlocked] = useState(false);
  const dirty =
    data !== null &&
    JSON.stringify(marks) !== JSON.stringify(initialMarks(data));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const busy = useRef(false),
    generation = useRef(0),
    actionEpoch = useRef(0),
    active = useRef(false);
  const operation = useRef<{
    fingerprint: string;
    body: AttendanceWrite;
    action: 'draft' | 'submit';
  } | null>(null);
  const load = useCallback(
    async (forceReview = false) => {
      const request = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        if (!accessToken) throw new Error('Authentication required.');
        const latest = await attendanceService.open(
          accessToken,
          periodId,
          date,
        );
        if (!active.current || request !== generation.current) return;
        setBlocked(false);
        if (dirtyRef.current || forceReview) {
          setReview(latest);
        } else {
          setData(latest);
          setMarks(initialMarks(latest));
          setReview(null);
        }
      } catch (failure) {
        if (!active.current || request !== generation.current) return;
        if (
          failure instanceof ApiError &&
          [401, 403, 404].includes(failure.status)
        )
          setBlocked(true);
        setError(
          failure instanceof ApiError && failure.status === 404
            ? 'This attendance occurrence is unavailable or you no longer have access.'
            : failure instanceof Error
            ? failure.message
            : 'Attendance could not be loaded.',
        );
      } finally {
        if (active.current && request === generation.current) setLoading(false);
      }
    },
    [accessToken, periodId, date],
  );
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      setPending(false);
      load();
      return () => {
        active.current = false;
        generation.current++;
        actionEpoch.current++;
        busy.current = false;
      };
    }, [load]),
  );
  useEffect(() => {
    setPending(false);
    operation.current = null;
    setData(null);
    setMarks([]);
    setReview(null);
    setError(null);
  }, [accessToken, periodId, date]);
  usePreventRemove(dirty || pending, ({ data: event }) => {
    if (busy.current) {
      Alert.alert(
        'Attendance is saving',
        'Wait for the server response before leaving.',
      );
      return;
    }
    Alert.alert(
      'Unsaved attendance',
      'Discard your in-memory changes and leave?',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard changes',
          style: 'destructive',
          onPress: () => navigation.dispatch(event.action),
        },
      ],
    );
  });
  const change = (studentId: string, status: AttendanceStatus | null) => {
    operation.current = null;
    setNotice(null);
    setMarks(current =>
      current.map(m => (m.studentId === studentId ? { ...m, status } : m)),
    );
  };
  const save = async (action: 'draft' | 'submit') => {
    if (!data || !accessToken || busy.current || blocked || review) return;
    if (
      action === 'submit' &&
      (!marks.length || marks.some(m => m.status === null))
    ) {
      setError(
        'Explicitly mark every student before submitting. Unmarked students are not absent.',
      );
      return;
    }
    const fingerprint = JSON.stringify({
      sessionId: data.sessionId,
      action,
      revision: data.revision,
      rosterVersion: data.rosterVersion,
      marks,
    });
    if (!operation.current || operation.current.fingerprint !== fingerprint)
      operation.current = {
        fingerprint,
        action,
        body: {
          revision: data.revision,
          rosterVersion: data.rosterVersion,
          marks,
          clientOperationId: attendanceOperationId(),
        },
      };
    const submitted = operation.current,
      epoch = actionEpoch.current;
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await attendanceService.save(
        accessToken,
        data.sessionId,
        action,
        submitted.body,
      );
      if (!active.current || epoch !== actionEpoch.current) return;
      operation.current = null;
      // Confirmed write, then reload; never manufacture a successful server state.
      const latest = await attendanceService.getSession(
        accessToken,
        data.sessionId,
      );
      if (!active.current || epoch !== actionEpoch.current) return;
      ++generation.current;
      setLoading(false);
      setData(latest);
      setMarks(initialMarks(latest));
      setReview(null);
      setBlocked(false);
      setNotice(
        action === 'submit'
          ? 'Attendance submission confirmed.'
          : 'Draft save confirmed.',
      );
    } catch (failure) {
      if (!active.current || epoch !== actionEpoch.current) return;
      const message =
        failure instanceof Error ? failure.message : 'Attendance save failed.';
      if (
        failure instanceof ApiError &&
        [401, 403, 404, 409].includes(failure.status)
      ) {
        if (failure.status !== 409) setBlocked(true);
        await load(true);
      }
      if (active.current && epoch === actionEpoch.current) setError(message);
    } finally {
      if (epoch === actionEpoch.current) {
        busy.current = false;
        if (active.current) setPending(false);
      }
    }
  };
  const editable =
    !!data?.canSave && !pending && !review && !blocked && !loading;
  return (
    <DashboardShell
      safeArea={false}
      refreshing={loading}
      onRefresh={() => {
        if (!busy.current) load();
      }}
    >
      <ScreenHeading title="Period attendance" subtitle={date} />
      <TimetableState
        loading={loading}
        error={error}
        retry={async () => {
          if (!busy.current) await load();
        }}
      />
      <Text style={timetableStyles.muted}>
        Draft changes stay in memory until saved. Unmarked never means absent.
      </Text>
      {notice ? <Text style={timetableStyles.body}>{notice}</Text> : null}
      {pending ? (
        <Text style={timetableStyles.body}>
          Waiting for server confirmation...
        </Text>
      ) : null}
      {review ? (
        <SectionCard title="Review current server attendance">
          <Text style={timetableStyles.body}>
            Your edits are preserved below. Current server revision{' '}
            {review.revision}; roster {review.students.length} students. Review
            before replacing your edits.
          </Text>
          {review.students.map(s => (
            <Text key={s.studentId} style={timetableStyles.body}>
              {s.fullName}: {s.status ?? 'Unmarked'}
            </Text>
          ))}
          <Button
            title="Use reviewed server state"
            disabled={pending}
            onPress={() => {
              setData(review);
              setMarks(initialMarks(review));
              setReview(null);
              operation.current = null;
              setError(null);
              setNotice(null);
            }}
          />
        </SectionCard>
      ) : null}
      {data ? (
        <>
          <Card>
            <PeriodSummary period={data.period} />
            <StatusBadge
              status={data.state === 'submitted' ? 'paid' : 'pending'}
              label={data.state}
            />
            <Text style={timetableStyles.muted}>
              Server revision {data.revision}
            </Text>
            <Text style={timetableStyles.muted}>
              Roster version {data.rosterVersion}
            </Text>
            {data.rosterChanged ? (
              <Text style={timetableStyles.body}>
                The current roster differs from the saved roster. Review it
                before saving. Submitted history remains unchanged.
              </Text>
            ) : null}
          </Card>
          <SectionCard title="Student attendance">
            {data.students.length === 0 ? (
              <Text style={timetableStyles.body}>
                No currently enrolled students in this session.
              </Text>
            ) : null}
            {data.canSave && !blocked ? (
              <Button
                title="Mark all present"
                disabled={!editable}
                onPress={() => {
                  operation.current = null;
                  setNotice(null);
                  setMarks(current =>
                    current.map(m => ({ ...m, status: 'present' })),
                  );
                }}
              />
            ) : null}
            {data.students.map(student => (
              <Card key={student.studentId}>
                <Text style={timetableStyles.body}>{student.fullName}</Text>
                <Text style={timetableStyles.muted}>
                  {student.admissionNumber}
                </Text>
                <Text style={timetableStyles.body}>
                  Status:{' '}
                  {marks.find(m => m.studentId === student.studentId)?.status ??
                    'Unmarked'}
                </Text>
                {!blocked ? (
                  <Button
                    title={`${
                      data.state === 'submitted'
                        ? 'Review attendance'
                        : 'Student leave'
                    } for ${student.fullName}`}
                    variant="secondary"
                    onPress={() =>
                      navigation.navigate('TeacherAttendanceReview', {
                        sessionId: data.sessionId,
                        studentId: student.studentId,
                      })
                    }
                  />
                ) : null}
                {data.canSave && !blocked ? (
                  <View>
                    {[null, ...statuses].map(status => (
                      <Pressable
                        key={status ?? 'unmarked'}
                        accessibilityRole="button"
                        accessibilityLabel={`${student.fullName}: ${
                          status ?? 'Unmarked'
                        }`}
                        accessibilityState={{
                          selected:
                            (marks.find(m => m.studentId === student.studentId)
                              ?.status ?? null) === status,
                          disabled: !editable,
                        }}
                        disabled={!editable}
                        style={timetableStyles.input}
                        onPress={() => change(student.studentId, status)}
                      >
                        <Text style={timetableStyles.body}>
                          {status ?? 'Unmarked'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </Card>
            ))}
          </SectionCard>
          {data.canSave && !blocked ? (
            <Card>
              <Button
                title="Save draft"
                disabled={!editable}
                onPress={() => {
                  save('draft');
                }}
              />
              <Button
                title="Submit attendance"
                disabled={!editable}
                onPress={() => {
                  save('submit');
                }}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </DashboardShell>
  );
}
