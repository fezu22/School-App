import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {useAuth} from '../../context/AuthContext';
import {hasPermission, PERMISSIONS} from '../../constants/permissions';
import {adminService, CreatePrincipalPayload} from '../../services/admin/adminService';
import {SuperAdminStackParamList} from '../../navigation/SuperAdminNavigator';
import {colors, fonts, shadow} from '../../theme/hiraTheme';

interface BranchOption {
  _id: string;
  name: string;
  code: string;
  city: string;
  address: string;
  isActive: boolean;
}

const initialForm = {
  fullName: '',
  email: '',
  phone: '',
  password: '',
};

const CreatePrincipalScreen = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<SuperAdminStackParamList>>();
  const {accessToken, user} = useAuth();

  const [form, setForm] = useState(initialForm);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [branchError, setBranchError] = useState('');
  const [isBranchModalVisible, setIsBranchModalVisible] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedBranch = useMemo(
    () => branches.find(branch => branch._id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const normalizeErrorMessage = useCallback((message: string): string => {
    const normalized = message.toLowerCase();

    if (
      normalized.includes('timed out') ||
      normalized.includes('network request') ||
      normalized.includes('failed to fetch') ||
      normalized.includes('fetch')
    ) {
      return 'Unable to connect to the server. Please check your connection and try again.';
    }

    if (normalized.includes('token') || normalized.includes('unauthorized')) {
      return 'Your session has expired. Please log in again.';
    }

    if (normalized.includes('permission')) {
      return 'You do not have permission to create principals.';
    }

    if (normalized.includes('already exists')) {
      return 'A user with this email already exists.';
    }

    if (normalized.includes('branch')) {
      return 'Select a valid school branch.';
    }

    return message || 'Unable to create principal right now.';
  }, []);

  const loadBranches = useCallback(async () => {
    if (!accessToken) {
      setBranchError('Authentication token is missing.');
      setLoadingBranches(false);
      return;
    }

    try {
      setLoadingBranches(true);
      setBranchError('');

      const response = await adminService.getBranches(accessToken);
      const nextBranches = Array.isArray(response.branches) ? response.branches : [];
      setBranches(nextBranches);

      if (nextBranches.length === 0) {
        setBranchError('No branches are available yet.');
      }
    } catch (error) {
      setBranchError(
        normalizeErrorMessage(
          error instanceof Error ? error.message : 'Failed to load branches.',
        ),
      );
    } finally {
      setLoadingBranches(false);
    }
  }, [accessToken, normalizeErrorMessage]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const validateForm = () => {
    const nextErrors: {[key: string]: string} = {};
    const trimmedName = form.fullName.trim();
    const trimmedEmail = form.email.trim();

    if (!trimmedName) {
      nextErrors.fullName = 'Full name is required.';
    }

    if (!trimmedEmail) {
      nextErrors.email = 'Enter a valid email address.';
    } else if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!selectedBranchId) {
      nextErrors.branchId = 'Select a school branch.';
    }

    if (!form.password) {
      nextErrors.password = 'Password is required.';
    } else if (form.password.length < 6) {
      nextErrors.password = 'Password must be at least 6 characters.';
    }

    return nextErrors;
  };

  const handleSubmit = async () => {
    if (!accessToken || !hasPermission(user?.role, PERMISSIONS.PRINCIPALS_MANAGE)) {
      setSubmitError('You do not have permission to create principals.');
      return;
    }

    const nextErrors = validateForm();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setSubmitError('Please correct the highlighted fields and try again.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    setSuccessMessage('');

    const payload: CreatePrincipalPayload = {
      fullName: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() || undefined,
      password: form.password,
      branchId: selectedBranchId,
    };

    try {
      await adminService.createPrincipal(accessToken, payload);
      setSuccessMessage('Principal created successfully.');
      setErrors({});
      setForm(initialForm);
      setSelectedBranchId('');

      setTimeout(() => {
        navigation.goBack();
      }, 1200);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? normalizeErrorMessage(error.message)
          : 'Failed to create principal.';

      setSubmitError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user || !hasPermission(user.role, PERMISSIONS.PRINCIPALS_MANAGE)) {
    return (
      <View style={styles.restrictedContainer}>
        <Text style={styles.restrictedTitle}>Access restricted</Text>
        <Text style={styles.restrictedText}>
          You do not have permission to create principal accounts.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>ADMINISTRATION</Text>
          </View>

          <Text style={styles.title}>Create Principal</Text>

          <Text style={styles.subtitle}>
            Create a principal account and assign it to a school branch.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Principal information</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              value={form.fullName}
              onChangeText={value => {
                setForm(prev => ({...prev, fullName: value}));
                if (errors.fullName) {
                  setErrors(prev => ({...prev, fullName: ''}));
                }
              }}
              placeholder="Enter full name"
              placeholderTextColor={colors.muted}
              style={[styles.input, errors.fullName ? styles.inputError : null]}
              autoCapitalize="words"
            />
            {errors.fullName ? (
              <Text style={styles.errorText}>{errors.fullName}</Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email address</Text>
            <TextInput
              value={form.email}
              onChangeText={value => {
                setForm(prev => ({...prev, email: value}));
                if (errors.email) {
                  setErrors(prev => ({...prev, email: ''}));
                }
              }}
              placeholder="principal@example.com"
              placeholderTextColor={colors.muted}
              style={[styles.input, errors.email ? styles.inputError : null]}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {errors.email ? (
              <Text style={styles.errorText}>{errors.email}</Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              value={form.phone}
              onChangeText={value => {
                setForm(prev => ({...prev, phone: value}));
              }}
              placeholder="Enter phone number"
              placeholderTextColor={colors.muted}
              style={styles.input}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>School branch</Text>
            <TouchableOpacity
              style={[styles.selectInput, errors.branchId ? styles.inputError : null]}
              activeOpacity={0.8}
              onPress={() => setIsBranchModalVisible(true)}>
              <Text
                style={selectedBranch ? styles.selectValue : styles.selectPlaceholder}>
                {selectedBranch
                  ? `${selectedBranch.name} (${selectedBranch.code})`
                  : 'Select school branch'}
              </Text>

              <Text style={styles.selectArrow}>⌄</Text>
            </TouchableOpacity>
            {errors.branchId ? (
              <Text style={styles.errorText}>{errors.branchId}</Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Temporary password</Text>
            <TextInput
              value={form.password}
              onChangeText={value => {
                setForm(prev => ({...prev, password: value}));
                if (errors.password) {
                  setErrors(prev => ({...prev, password: ''}));
                }
              }}
              placeholder="Enter temporary password"
              placeholderTextColor={colors.muted}
              style={[styles.input, errors.password ? styles.inputError : null]}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            {errors.password ? (
              <Text style={styles.errorText}>{errors.password}</Text>
            ) : null}
          </View>

          <View style={styles.infoBox}>
            <View style={styles.infoIcon}>
              <Text style={styles.infoIconText}>i</Text>
            </View>

            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Account security</Text>

              <Text style={styles.infoText}>
                The account will be created with the Principal role. Branch
                security and access will be enforced by the backend.
              </Text>
            </View>
          </View>

          {submitError ? (
            <View style={styles.alertBox}>
              <Text style={styles.alertText}>{submitError}</Text>
            </View>
          ) : null}

          {successMessage ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.button, isSubmitting && styles.buttonDisabled]}
            activeOpacity={0.85}
            disabled={isSubmitting}
            onPress={handleSubmit}>
            {isSubmitting ? (
              <View style={styles.submitLoading}>
                <ActivityIndicator color="#ffffff" size="small" />
                <Text style={styles.buttonText}>Creating Principal...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Create Principal</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Only authorized Super Admin users can create principal accounts.
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={isBranchModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsBranchModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select school branch</Text>
              <TouchableOpacity onPress={() => setIsBranchModalVisible(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            {loadingBranches ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.modalMessage}>Loading branches...</Text>
              </View>
            ) : branchError ? (
              <View style={styles.modalLoading}>
                <Text style={styles.modalError}>{branchError}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={loadBranches}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : branches.length === 0 ? (
              <Text style={styles.modalEmpty}>No branches available.</Text>
            ) : (
              <ScrollView style={styles.branchList}>
                {branches.map(branch => (
                  <TouchableOpacity
                    key={branch._id}
                    style={[
                      styles.branchItem,
                      selectedBranchId === branch._id && styles.branchItemSelected,
                    ]}
                    onPress={() => {
                      setSelectedBranchId(branch._id);
                      setErrors(prev => ({...prev, branchId: ''}));
                      setIsBranchModalVisible(false);
                    }}>
                    <Text style={styles.branchName}>{branch.name}</Text>
                    <Text style={styles.branchMeta}>
                      {branch.code} • {branch.city}
                    </Text>
                    <Text style={styles.branchMeta}>{branch.address}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  restrictedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.cream,
  },
  restrictedTitle: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 8,
  },
  restrictedText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  headerBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e7f0ee',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
  },
  headerBadgeText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.primary,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 28,
    color: colors.ink,
    marginBottom: 7,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    ...shadow,
  },
  sectionTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.ink,
    marginBottom: 20,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.ink,
    marginBottom: 7,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.cream,
  },
  inputError: {
    borderColor: colors.danger,
    backgroundColor: '#fff7f7',
  },
  selectInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cream,
  },
  selectPlaceholder: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  selectValue: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  selectArrow: {
    fontSize: 20,
    color: colors.primary,
    marginTop: -4,
  },
  errorText: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 12,
    marginTop: 6,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#edf4f3',
    borderRadius: 14,
    padding: 14,
    marginTop: 2,
    marginBottom: 20,
  },
  infoIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  infoIconText: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: '#ffffff',
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: colors.primary,
    marginBottom: 4,
  },
  infoText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  alertBox: {
    backgroundColor: '#fbe7e4',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f1c8c8',
  },
  alertText: {
    color: colors.danger,
    fontSize: 13,
    fontFamily: fonts.body,
  },
  successBox: {
    backgroundColor: '#e1f1e7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bee0c9',
  },
  successText: {
    color: colors.success,
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
  button: {
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  submitLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: '#ffffff',
  },
  footer: {
    paddingHorizontal: 10,
    paddingTop: 16,
  },
  footerText: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    color: colors.muted,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(19, 31, 31, 0.28)',
  },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: '72%',
    padding: 20,
    ...shadow,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.ink,
  },
  closeText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.primary,
  },
  modalLoading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalMessage: {
    marginTop: 12,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  modalError: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: '#ffffff',
  },
  branchList: {
    maxHeight: 360,
  },
  branchItem: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cream,
    marginBottom: 10,
  },
  branchItemSelected: {
    borderColor: colors.primary,
    backgroundColor: '#edf4f3',
  },
  branchName: {
    fontFamily: fonts.heading,
    fontSize: 15,
    color: colors.ink,
  },
  branchMeta: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  modalEmpty: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    paddingVertical: 16,
    textAlign: 'center',
  },
});

export default CreatePrincipalScreen;