import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { Button, SectionCard } from '../../components/hiraDashboard';
import {
  AdminDialog,
  AdminDateField,
  AdminFeedback,
  AdminSelect,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import { colors } from '../../theme/hiraDashboard';
import { ApiError } from '../../services/api/apiClient';
import {
  enrollmentService,
  type EnrollmentOptions,
} from '../../services/admin/enrollmentService';
import {
  studentAdminService,
  type AdmissionInput,
  type ProfileFields,
  type ProfileResult,
} from '../../services/admin/studentAdminService';

const empty: ProfileFields = {
  fullName: '',
  admissionNumber: '',
  dateOfBirth: '',
  gender: '',
  guardianName: '',
  guardianPhone: '',
  address: '',
  phone: '',
};
export function studentFormErrors(
  fields: ProfileFields,
  email?: string,
  password?: string,
) {
  const errors: Record<string, string> = {};
  if (fields.fullName.trim().length < 2)
    errors.fullName = 'Enter the Student’s full name.';
  if (!fields.admissionNumber.trim())
    errors.admissionNumber = 'Enter the admission number.';
  if (
    fields.dateOfBirth &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dateOfBirth) ||
      Number.isNaN(Date.parse(fields.dateOfBirth + 'T00:00:00Z')) ||
      new Date(fields.dateOfBirth + 'T00:00:00Z').toISOString().slice(0, 10) !==
        fields.dateOfBirth)
  )
    errors.dateOfBirth = 'Enter a valid date as YYYY-MM-DD.';
  for (const key of ['phone', 'guardianPhone'] as const)
    if (fields[key] && !/^\+?[0-9 ()-]{6,25}$/.test(fields[key]))
      errors[key] = 'Enter a valid phone number.';
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    errors.email = 'Enter a valid Student account email.';
  const bytes =
    password === undefined
      ? 0
      : Array.from(password).reduce((size, char) => {
          const code = char.codePointAt(0) ?? 0;
          return (
            size + (code > 65535 ? 4 : code > 2047 ? 3 : code > 127 ? 2 : 1)
          );
        }, 0);
  if (password !== undefined && (password.length < 12 || bytes > 72))
    errors.password = 'Use at least 12 characters and at most 72 UTF-8 bytes.';
  return errors;
}
function Input({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={formStyles.field}>
      <Text style={formStyles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        style={formStyles.input}
        placeholderTextColor={colors.muted}
      />
      {error ? (
        <Text accessibilityRole="alert" style={formStyles.helper}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
function Fields({
  fields,
  change,
  errors,
  disabled,
}: {
  fields: ProfileFields;
  change: (key: keyof ProfileFields, value: string) => void;
  errors: Record<string, string>;
  disabled: boolean;
}) {
  const input = (
    key: keyof ProfileFields,
    label: string,
    maxLength: number,
    extra: TextInputProps = {},
  ) => (
    <Input
      label={label}
      value={fields[key]}
      onChangeText={value => change(key, value)}
      editable={!disabled}
      error={errors[key]}
      maxLength={maxLength}
      {...extra}
    />
  );
  return (
    <>
      <Text style={formStyles.heading}>Student information</Text>
      {input('fullName', 'Full name', 100)}
      {input('admissionNumber', 'Admission number', 80, {
        autoCapitalize: 'characters',
      })}
      <AdminDateField
        label="Date of birth (YYYY-MM-DD, optional)"
        value={fields.dateOfBirth}
        onChange={value => change('dateOfBirth', value)}
        disabled={disabled}
        helper="Optional calendar date. Use YYYY-MM-DD."
        error={errors.dateOfBirth}
      />
      <AdminSelect
        label="Gender (optional)"
        value={fields.gender}
        options={[
          { id: '', label: 'Not specified' },
          { id: 'male', label: 'Male' },
          { id: 'female', label: 'Female' },
          { id: 'other', label: 'Other' },
        ]}
        placeholder="Not specified"
        helper="Optional profile information"
        disabled={disabled}
        onSelect={value => change('gender', value)}
      />
      <Text style={formStyles.heading}>Guardian / contact</Text>
      {input('guardianName', 'Guardian name (optional)', 100)}
      {input('guardianPhone', 'Guardian phone (optional)', 25, {
        keyboardType: 'phone-pad',
      })}
      {input('phone', 'Student phone (optional)', 25, {
        keyboardType: 'phone-pad',
      })}
      {input('address', 'Address (optional)', 255, { multiline: true })}
    </>
  );
}
function message(error: unknown) {
  if (error instanceof ApiError && [401, 403].includes(error.status))
    return 'Your account can no longer perform this action. Refresh or contact your administrator.';
  return error instanceof Error
    ? error.message
    : 'Unable to reach the server. Check your connection and retry.';
}
type Notice = { kind: 'success' | 'error'; title: string; message: string };
export function StudentAdmissionForm({
  token,
  onClose,
  onCreated,
  onAcademicSetup,
}: {
  token: string;
  onClose: () => void;
  onCreated: (id: string, viewProfile?: boolean) => void;
  onAcademicSetup: () => void;
}) {
  const [fields, setFields] = useState({ ...empty }),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [options, setOptions] = useState<EnrollmentOptions | null>(null),
    [classId, setClass] = useState(''),
    [sectionId, setSection] = useState(''),
    [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(''),
    [notice, setNotice] = useState<Notice | null>(null),
    [created, setCreated] = useState<ProfileResult | null>(null),
    [uncertain, setUncertain] = useState(false);
  const generation = useRef(0),
    mounted = useRef(true),
    pending = useRef(false),
    frozen = useRef<AdmissionInput | null>(null);
  const operation = useRef(
    'student_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2),
  );
  const load = useCallback(
    async (target?: string, offset = 0) => {
      const request = ++generation.current;
      setLoading(true);
      setLoadError('');
      setOptions(null);
      try {
        const result = await enrollmentService.options(token, target, offset);
        if (request === generation.current && mounted.current) {
          setOptions(result);
          setPage(offset);
        }
      } catch (error) {
        if (request === generation.current && mounted.current)
          setLoadError(message(error));
      } finally {
        if (request === generation.current && mounted.current)
          setLoading(false);
      }
    },
    [token],
  );
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);
  function validate() {
    const next = studentFormErrors(fields, email, password);
    if (!options?.period || !classId || !sectionId)
      next.placement = 'Choose an active Academic Period, Class and Section.';
    setErrors(next);
    if (!Object.keys(next).length) setReview(true);
  }
  async function save() {
    if (pending.current || !options?.period) return;
    pending.current = true;
    setBusy(true);
    setFailure('');
    const body = frozen.current ?? {
      ...fields,
      email: email.trim().toLowerCase(),
      password,
      academicPeriodId: options.period.id,
      classId,
      sectionId,
      operationId: operation.current,
    };
    frozen.current = body;
    try {
      const result = await studentAdminService.admit(token, body);
      if (!mounted.current) return;
      setCreated(result);
      setPassword('');
      frozen.current = null;
      setUncertain(false);
      const placement = result.initialEnrollment;
      setNotice({
        kind: 'success',
        title: 'Student Created',
        message: placement
          ? `${result.student.fullName} was created and enrolled in ${placement.period.name} / ${placement.class.name} / ${placement.section.name}.`
          : `${result.student.fullName}’s admission is confirmed. Open the Student profile to view the current placement and history.`,
      });
    } catch (error) {
      if (!mounted.current) return;
      setFailure(message(error));
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        frozen.current = null;
        setUncertain(false);
        setReview(false);
        if (error.status === 409)
          setNotice({
            kind: 'error',
            title: message(error).includes('already in use')
              ? 'Student Already Exists'
              : 'Admission Conflict',
            message: message(error),
          });
        if ([401, 403].includes(error.status))
          setNotice({
            kind: 'error',
            title: 'Action Not Available',
            message: message(error),
          });
      } else {
        setUncertain(true);
        setFailure(
          'Admission was not confirmed. Check Students before starting another admission, or retry this same request safely. ' +
            message(error),
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const cls = options?.classes.find(row => row.id === classId),
    section = options?.sections.find(row => row.id === sectionId);
  return (
    <>
      <AdminDialog
        visible={!notice}
        title={review ? 'Review Student admission' : 'Add Student'}
        confirmTitle={
          review
            ? uncertain
              ? 'Retry admission safely'
              : 'Create Student'
            : 'Review admission'
        }
        busy={busy}
        busyLabel="Creating Student"
        onConfirm={review ? save : validate}
        onClose={onClose}
      >
        {review ? (
          <>
            <Text style={formStyles.heading}>
              {fields.fullName} · {fields.admissionNumber}
            </Text>
            <Text style={formStyles.copy}>Account: {email}</Text>
            <Text style={formStyles.copy}>
              {options?.period?.name} / {cls?.name} / {section?.name}
            </Text>
            <Text style={formStyles.copy}>
              Guardian: {fields.guardianName || 'Not specified'} ·{' '}
              {fields.guardianPhone || 'Not specified'}
            </Text>
            <Text style={formStyles.copy}>
              Date of birth: {fields.dateOfBirth || 'Not specified'} · Gender:{' '}
              {fields.gender || 'Not specified'}
            </Text>
            <Text style={formStyles.copy}>
              Student phone: {fields.phone || 'Not specified'}
            </Text>
            <Text style={formStyles.copy}>
              Address: {fields.address || 'Not specified'}
            </Text>
            <Text style={formStyles.helper}>
              A permanent Student profile and initial enrollment will be created
              together. Share the chosen account credentials securely.
            </Text>
            {!uncertain ? (
              <Button
                title="Edit admission details"
                variant="secondary"
                disabled={busy}
                onPress={() => setReview(false)}
              />
            ) : null}
          </>
        ) : (
          <>
            <Fields
              fields={fields}
              change={(key, value) =>
                setFields(old => ({ ...old, [key]: value }))
              }
              errors={errors}
              disabled={busy}
            />
            <Text style={formStyles.heading}>Student login account</Text>
            <Text style={formStyles.helper}>
              A unique Student email and explicit initial password are required
              by the school account system. No default password is generated.
            </Text>
            <Input
              label="Student account email"
              value={email}
              onChangeText={setEmail}
              error={errors.email}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!busy}
              maxLength={254}
            />
            <Input
              label="Initial password"
              value={password}
              onChangeText={setPassword}
              error={errors.password}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <Text style={formStyles.heading}>
              Academic placement · your Branch
            </Text>
            {loading ? (
              <ActivityIndicator
                accessibilityLabel="Loading academic placement"
                color={colors.primary}
              />
            ) : null}
            {loadError ? (
              <>
                <AdminFeedback
                  kind="error"
                  title="Academic options unavailable"
                  message={loadError}
                />
                <Button
                  title="Retry academic placement"
                  onPress={() => load(classId || undefined, page)}
                />
              </>
            ) : null}
            {!loading && !loadError && !options?.period ? (
              <>
                <AdminFeedback
                  kind="error"
                  title="Academic Setup Required"
                  message="No active Academic Period is available for Student enrollment."
                />
                <Button title="Open Academic Setup" onPress={onAcademicSetup} />
              </>
            ) : null}
            {options?.period ? (
              <>
                <AdminSelect
                  label="Academic Period"
                  value={options.period.id}
                  options={[
                    { id: options.period.id, label: options.period.name },
                  ]}
                  placeholder="Active Period"
                  helper="The active school Academic Period"
                  disabled={busy || loading}
                  onSelect={() => {
                    setClass('');
                    setSection('');
                    load();
                  }}
                />
                <AdminSelect
                  label="Admission Class"
                  value={classId}
                  options={options.classes.map(row => ({
                    id: row.id,
                    label: row.name + ' (' + row.code + ')',
                  }))}
                  placeholder="Choose a Class"
                  helper={
                    !options.classes.length
                      ? 'No Classes are configured for this Academic Period.'
                      : 'Classes in the active Academic Period'
                  }
                  disabled={busy || loading}
                  onSelect={value => {
                    setClass(value);
                    setSection('');
                    load(value, page);
                  }}
                />
                <AdminSelect
                  label="Admission Section"
                  value={sectionId}
                  options={options.sections.map(row => ({
                    id: row.id,
                    label: row.name + ' (' + row.code + ')',
                  }))}
                  placeholder="Choose a Section"
                  helper={
                    !classId
                      ? 'Choose a Class first.'
                      : !options.sections.length
                      ? 'No Sections exist for this Class.'
                      : 'Sections of the selected Class'
                  }
                  disabled={busy || loading || !classId}
                  onSelect={setSection}
                />
                {page > 0 ? (
                  <Button
                    title="Previous admission Classes"
                    onPress={() => {
                      setClass('');
                      setSection('');
                      load(undefined, Math.max(0, page - 50));
                    }}
                  />
                ) : null}
                {options.nextOffset !== null ? (
                  <Button
                    title="More admission Classes"
                    onPress={() => {
                      setClass('');
                      setSection('');
                      load(undefined, options.nextOffset!);
                    }}
                  />
                ) : null}
                {!options.classes.length ||
                (classId && !options.sections.length) ? (
                  <Button
                    title="Open Academic Setup"
                    variant="secondary"
                    onPress={onAcademicSetup}
                  />
                ) : null}
              </>
            ) : null}
            {errors.placement ? (
              <Text accessibilityRole="alert" style={formStyles.helper}>
                {errors.placement}
              </Text>
            ) : null}
          </>
        )}
        {failure ? (
          <AdminFeedback
            kind="error"
            title="Admission not confirmed"
            message={failure}
          />
        ) : null}
      </AdminDialog>
      <AdminDialog
        visible={!!notice}
        title={notice?.title ?? ''}
        confirmTitle={created ? 'View Student' : 'Return to form'}
        closeTitle={created ? 'Done' : 'Cancel'}
        onConfirm={() =>
          created ? onCreated(created.student.id) : setNotice(null)
        }
        onClose={() =>
          created ? onCreated(created.student.id, false) : setNotice(null)
        }
      >
        {notice ? <AdminFeedback {...notice} /> : null}
      </AdminDialog>
    </>
  );
}

export function StudentProfilePanel({
  token,
  id,
  onSaved,
}: {
  token: string;
  id: string;
  onSaved: (result: ProfileResult) => void;
}) {
  const [data, setData] = useState<ProfileResult | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  const [fields, setFields] = useState({ ...empty }),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState<Notice | null>(null);
  const generation = useRef(0),
    lock = useRef(false),
    alive = useRef(true);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setData(null);
    setError('');
    try {
      const result = await studentAdminService.profile(token, id);
      if (alive.current && current === generation.current) setData(result);
    } catch (failure) {
      if (alive.current && current === generation.current)
        setError(message(failure));
    } finally {
      if (alive.current && current === generation.current) setLoading(false);
    }
  }, [token, id]);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, [load]);
  async function save() {
    if (!data || lock.current) return;
    const next = studentFormErrors(fields);
    setErrors(next);
    if (Object.keys(next).length) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await studentAdminService.edit(token, id, {
        ...fields,
        revision: data.student.revision,
      });
      if (alive.current) {
        setData(result);
        setEditing(false);
        setNotice({
          kind: 'success',
          title: 'Profile saved',
          message:
            'Permanent Student information was updated. Academic placement and history are unchanged.',
        });
        onSaved(result);
      }
    } catch (failure) {
      if (alive.current) {
        setError(message(failure));
        if (
          failure instanceof ApiError &&
          [401, 403, 409].includes(failure.status)
        ) {
          if (failure.status !== 409) {
            setData(null);
            setEditing(false);
          }
          setNotice({
            kind: 'error',
            title:
              failure.status === 409
                ? 'Profile Conflict'
                : 'Action Not Available',
            message:
              message(failure) + ' Refresh the profile before editing again.',
          });
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <SectionCard title="Student Profile">
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading Student profile"
          color={colors.primary}
        />
      ) : null}
      {error ? (
        <AdminFeedback
          kind="error"
          title="Profile unavailable / change not confirmed"
          message={error}
        />
      ) : null}
      <Button
        title="Refresh Student profile"
        variant="secondary"
        disabled={busy || loading}
        onPress={() => {
          setEditing(false);
          load();
        }}
      />
      {data ? (
        <>
          <Text style={formStyles.heading}>{data.student.fullName}</Text>
          <Text style={formStyles.copy}>
            {data.student.admissionNumber} ·{' '}
            {data.student.isActive ? 'Active profile' : 'Inactive profile'}
          </Text>
          <Text style={formStyles.copy}>
            Account email: {data.student.email}
          </Text>
          <Text style={formStyles.copy}>
            Date of birth: {data.student.dateOfBirth || 'Not specified'} ·
            Gender: {data.student.gender || 'Not specified'}
          </Text>
          <Text style={formStyles.copy}>
            Guardian: {data.student.guardianName || 'Not specified'} ·{' '}
            {data.student.guardianPhone || 'No guardian phone'}
          </Text>
          <Text style={formStyles.copy}>
            Phone: {data.student.phone || 'Not specified'}
          </Text>
          <Text style={formStyles.copy}>
            Address: {data.student.address || 'Not specified'}
          </Text>
          {data.capabilities.editProfile ? (
            <Button
              title="Edit Profile"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                const student = data.student;
                setFields(
                  Object.fromEntries(
                    Object.keys(empty).map(key => [
                      key,
                      student[key as keyof ProfileFields],
                    ]),
                  ) as ProfileFields,
                );
                setErrors({});
                setEditing(true);
                setError('');
              }}
            />
          ) : null}
        </>
      ) : null}
      <AdminDialog
        visible={editing && !notice}
        title="Edit Student Profile"
        confirmTitle="Save Profile"
        busy={busy}
        busyLabel="Saving Student profile"
        onConfirm={save}
        onClose={() => setEditing(false)}
      >
        <Text style={formStyles.helper}>
          This changes permanent information only. Use enrollment actions to
          change placement.
        </Text>
        <Fields
          fields={fields}
          change={(key, value) => setFields(old => ({ ...old, [key]: value }))}
          errors={errors}
          disabled={busy}
        />
        {error ? (
          <AdminFeedback
            kind="error"
            title="Profile not saved"
            message={error}
          />
        ) : null}
      </AdminDialog>
      <AdminDialog
        visible={!!notice}
        title={notice?.title ?? ''}
        closeTitle="Done"
        onClose={() => {
          if (notice?.kind === 'error') {
            setEditing(false);
            load();
          }
          setNotice(null);
        }}
      >
        {notice ? <AdminFeedback {...notice} /> : null}
      </AdminDialog>
    </SectionCard>
  );
}
