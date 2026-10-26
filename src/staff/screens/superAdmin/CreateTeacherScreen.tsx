import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SuperAdminStackParamList } from '../../navigation/SuperAdminNavigator';
import {
  Button,
  Card,
  DashboardShell,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { adminService } from '../../services/admin/adminService';
import {
  AdminFeedback,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import { colors, radius, spacing, typography } from '../../theme/hiraDashboard';

type BranchOption = { id: string; name: string; code: string };
const initial = { fullName: '', email: '', password: '' };
const passwordBytes = (value: string) =>
  Array.from(value).reduce((bytes, char) => {
    const code = char.codePointAt(0)!;
    return bytes + (code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4);
  }, 0);
export default function CreateTeacherScreen() {
  const { user, accessToken } = useAuth();
  const navigation =
    useNavigation<NativeStackNavigationProp<SuperAdminStackParamList>>();
  const [createdTeacherId, setCreatedTeacherId] = useState('');
  const allowed =
    user?.role === 'super_admin' &&
    hasPermission(user.role, PERMISSIONS.TEACHERS_CREATE);
  const [form, setForm] = useState(initial);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [branchError, setBranchError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0),
    busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return;
    const id = ++generation.current;
    if (!allowed || !accessToken) return;
    setLoading(true);
    setBranchError('');
    try {
      const response = await adminService.getTeacherBranches(accessToken);
      if (id !== generation.current) return;
      setBranches(response.data);
      setBranchId(selected =>
        response.data.some(b => b.id === selected) ? selected : '',
      );
    } catch (e) {
      if (id === generation.current) {
        setBranches([]);
        setBranchError(
          e instanceof Error ? e.message : 'Unable to load active branches.',
        );
      }
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [accessToken, allowed]);
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  const invalidForm =
    form.fullName.trim().length < 2 ||
    form.fullName.trim().length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ||
    form.email.trim().length > 254 ||
    form.password.length < 12 ||
    passwordBytes(form.password) > 72 ||
    !branches.some(b => b.id === branchId);
  const submit = async () => {
    if (busy.current || !allowed || !accessToken) return;
    if (invalidForm) {
      setError(
        'Enter a name, valid email, password of at least 12 characters (at most 72 UTF-8 bytes), and active branch.',
      );
      return;
    }
    const id = generation.current;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await adminService.createTeacher(accessToken, {
        ...form,
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        branchId,
      });
      if (id !== generation.current) return;
      if (
        !response.success ||
        response.data?.role !== 'teacher' ||
        typeof response.data.id !== 'string' ||
        !response.data.id ||
        response.data.branchId !== branchId
      )
        throw new Error('Account creation was not confirmed.');
      setCreatedTeacherId(response.data.id);
      setSuccess(true);
      setForm(initial);
    } catch (e) {
      if (id === generation.current)
        setError(
          e instanceof Error ? e.message : 'Unable to create Teacher account.',
        );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  if (!allowed)
    return (
      <DashboardShell>
        <ScreenHeading
          title="Access restricted"
          subtitle="Only an authorized Super Admin can create Teacher accounts."
        />
      </DashboardShell>
    );
  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <DashboardShell
        refreshing={loading}
        onRefresh={load}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.badge}>
          <Text style={styles.badgeText}>ADMINISTRATION</Text>
        </View>
        <View accessible accessibilityRole="header">
          <ScreenHeading
            title="Create Teacher"
            subtitle="Create a Teacher account for this school. Academic class, section and subject access is assigned separately."
          />
        </View>
        {success ? (
          <>
            <AdminFeedback
              kind="success"
              title="Teacher account created successfully."
              message="Academic access is not assigned yet."
            />
            <SectionCard title="Next step: academic assignment">
              <Text style={styles.copy}>
                This Teacher still requires class/section/subject assignment
                before academic modules become available. Assignment
                administration is managed separately by an authorized school
                administrator.
              </Text>
              <Button
                title="Assign Teacher"
                disabled={
                  !hasPermission(
                    user?.role,
                    PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE,
                  )
                }
                onPress={() =>
                  navigation.navigate('AssignTeacher', {
                    teacherId: createdTeacherId,
                  })
                }
                style={styles.primaryAction}
              />
              <Button
                title="Create another Teacher"
                variant="secondary"
                onPress={() => {
                  setSuccess(false);
                  setBranchId('');
                  load();
                }}
              />
            </SectionCard>
          </>
        ) : (
          <>
            <SectionCard title="Teacher Account">
              <Text style={styles.copy}>
                Create login credentials and assign the Teacher to an active
                branch. Academic teaching access is configured after account
                creation.
              </Text>
              <Text style={styles.role}>Role: Teacher (fixed)</Text>
            </SectionCard>
            <Card>
              <Text accessibilityRole="header" style={formStyles.heading}>
                Teacher Details
              </Text>
              <Text style={styles.copy}>
                Enter the Teacher’s identity and login information. All fields
                are required.
              </Text>
              <Text accessibilityRole="header" style={styles.groupTitle}>
                Personal Information
              </Text>
              {(['fullName', 'email'] as const).map(field => (
                <View key={field} style={formStyles.field}>
                  <Text style={formStyles.label}>
                    {field === 'fullName' ? 'Full name' : 'Email address'}
                  </Text>
                  <TextInput
                    accessibilityLabel={
                      field === 'fullName' ? 'Full name' : 'Login email'
                    }
                    placeholder={
                      field === 'fullName'
                        ? 'Enter full name'
                        : 'teacher@school.com'
                    }
                    value={form[field]}
                    editable={!saving}
                    autoCapitalize={field === 'fullName' ? 'words' : 'none'}
                    autoCorrect={false}
                    keyboardType={
                      field === 'email' ? 'email-address' : 'default'
                    }
                    onChangeText={value =>
                      setForm(current => ({ ...current, [field]: value }))
                    }
                    placeholderTextColor={colors.muted}
                    style={[formStyles.input, styles.input]}
                  />
                </View>
              ))}
              <Text accessibilityRole="header" style={styles.groupTitle}>
                Account Security
              </Text>
              <View style={formStyles.field}>
                <Text style={formStyles.label}>Password</Text>
                <TextInput
                  accessibilityLabel="Password"
                  placeholder="Enter a secure password"
                  placeholderTextColor={colors.muted}
                  value={form.password}
                  editable={!saving}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={value =>
                    setForm(current => ({ ...current, password: value }))
                  }
                  style={[formStyles.input, styles.input]}
                />
                <Text style={formStyles.helper}>
                  Use at least 12 characters, with a maximum of 72 UTF-8 bytes.
                </Text>
              </View>
              <Text accessibilityRole="header" style={styles.groupTitle}>
                School Assignment
              </Text>
              <Text style={formStyles.label}>Active branch</Text>
              <Text style={styles.copy}>
                Select the branch this Teacher account belongs to. Class,
                section and subject access is assigned in the next step.
              </Text>
              {loading ? (
                <View style={styles.branchState}>
                  <ActivityIndicator
                    accessibilityLabel="Loading branches"
                    color={colors.primary}
                  />
                  <Text style={formStyles.helper}>
                    Loading active branches…
                  </Text>
                </View>
              ) : branchError ? (
                <>
                  <Text accessibilityRole="alert" style={styles.error}>
                    {branchError}
                  </Text>
                  <Button
                    title="Retry branches"
                    onPress={() => {
                      load();
                    }}
                  />
                </>
              ) : branches.length === 0 ? (
                <Text style={styles.copy}>
                  No active branches are available.
                </Text>
              ) : (
                branches.map(branch => (
                  <Button
                    key={branch.id}
                    title={`${branch.name} (${branch.code})${
                      branchId === branch.id ? ' — Selected' : ''
                    }`}
                    variant={branchId === branch.id ? 'primary' : 'secondary'}
                    disabled={saving}
                    onPress={() => setBranchId(branch.id)}
                    style={styles.option}
                  />
                ))
              )}
            </Card>
            {error ? (
              <AdminFeedback
                kind="error"
                title="Unable to create Teacher"
                message={error}
              />
            ) : null}
            <Button
              title={saving ? 'Creating Teacher…' : 'Create Teacher'}
              disabled={
                saving ||
                loading ||
                !!branchError ||
                !branches.length ||
                invalidForm
              }
              onPress={() => {
                submit();
              }}
              style={styles.primaryAction}
            />
            <Text style={styles.footer}>
              Only authorized Super Admin users can create Teacher accounts.
            </Text>
          </>
        )}
      </DashboardShell>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.soft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  badgeText: {
    ...typography.caption,
    color: colors.primary,
    letterSpacing: 0.8,
  },
  copy: { ...typography.body, color: colors.muted, marginBottom: spacing.md },
  role: { ...typography.bodyStrong, color: colors.primary },
  groupTitle: {
    ...typography.h3,
    color: colors.ink,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  input: { minHeight: 52, backgroundColor: colors.cardWarm },
  branchState: { alignItems: 'center', paddingVertical: spacing.md },
  primaryAction: { minHeight: 54, marginBottom: spacing.md },
  footer: { ...typography.small, color: colors.muted, textAlign: 'center' },
  option: { marginBottom: spacing.sm },
  error: {
    ...typography.body,
    color: colors.danger.text,
    marginBottom: spacing.md,
  },
});
