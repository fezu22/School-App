import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { colors, radius, spacing, typography } from '../../theme/hiraDashboard';
export function AdminDialog({
  visible,
  title,
  children,
  onClose,
  onConfirm,
  confirmTitle,
  busy = false,
  danger = false,
  busyLabel = 'Saving assignment',
  closeTitle = 'Cancel',
}: {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmTitle?: string;
  busy?: boolean;
  danger?: boolean;
  busyLabel?: string;
  closeTitle?: string;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={formStyles.overlay}
      >
        <View pointerEvents="none" style={formStyles.backdrop} />
        <Card style={formStyles.dialog}>
          <View accessibilityViewIsModal style={formStyles.dialogBody}>
            <Text accessibilityRole="header" style={formStyles.heading}>
              {title}
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={formStyles.dialogScroll}
            >
              {children}
            </ScrollView>
            {busy ? (
              <ActivityIndicator
                accessibilityLabel={busyLabel}
                color={colors.primary}
              />
            ) : null}
            {onConfirm ? (
              <Button
                title={busy ? 'Saving...' : confirmTitle ?? 'Confirm'}
                onPress={onConfirm}
                disabled={busy}
                variant={danger ? 'danger' : 'primary'}
                style={formStyles.action}
              />
            ) : null}
            <Button
              title={closeTitle}
              variant="secondary"
              onPress={onClose}
              disabled={busy}
            />
          </View>
        </Card>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function AdminFeedback({
  kind,
  title,
  message,
}: {
  kind: 'success' | 'error';
  title: string;
  message: string;
}) {
  return (
    <Card style={kind === 'success' ? formStyles.success : formStyles.error}>
      <View accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={formStyles.heading}>{title}</Text>
        <Text style={formStyles.copy}>{message}</Text>
      </View>
    </Card>
  );
}
export function AdminSelect({
  label,
  value,
  options,
  placeholder,
  helper,
  disabled,
  loading,
  onSelect,
}: {
  label: string;
  value: string;
  options: { id: string; label: string; detail?: string }[];
  placeholder: string;
  helper: string;
  disabled?: boolean;
  loading?: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('');
  const selected = options.find(o => o.id === value);
  const matches = options.filter(o =>
    `${o.label} ${o.detail ?? ''}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <View style={formStyles.field}>
      <Text style={formStyles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityState={{
          disabled: !!disabled || !!loading,
          expanded: open,
        }}
        disabled={disabled || loading}
        onPress={() => {
          setSearch('');
          setOpen(true);
        }}
        style={[
          formStyles.input,
          selected && formStyles.selected,
          (disabled || loading) && formStyles.disabled,
        ]}
      >
        <Text style={formStyles.copy}>
          {loading ? 'Loading options...' : selected?.label ?? placeholder}
        </Text>
      </Pressable>
      <Text style={formStyles.helper}>{helper}</Text>
      <AdminDialog
        visible={open && !disabled && !loading}
        title={`Select ${label}`}
        onClose={() => setOpen(false)}
      >
        <TextInput
          accessibilityLabel={`Search ${label}`}
          placeholder={`Search ${label.toLowerCase()}`}
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          style={formStyles.input}
          autoCorrect={false}
        />
        {matches.map(o => (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            accessibilityLabel={`${o.label}${o.detail ? ', ' + o.detail : ''}`}
            accessibilityState={{ selected: o.id === value }}
            style={[formStyles.choice, o.id === value && formStyles.selected]}
            onPress={() => {
              onSelect(o.id);
              setOpen(false);
            }}
          >
            <Text style={formStyles.label}>{o.label}</Text>
            {o.detail ? (
              <Text style={formStyles.helper}>{o.detail}</Text>
            ) : null}
          </Pressable>
        ))}
        {!matches.length ? (
          <Text style={formStyles.copy}>No matching options.</Text>
        ) : null}
      </AdminDialog>
    </View>
  );
}
export function AdminDateField({
  label,
  value,
  onChange,
  helper,
  error,
  disabled,
  placeholder = 'YYYY-MM-DD',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  helper: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={formStyles.field}>
      <Text style={formStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={10}
        style={[formStyles.input, focused && formStyles.selected]}
      />
      <Text style={formStyles.helper}>{error ?? helper}</Text>
    </View>
  );
}
export const formStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    backgroundColor: colors.ink,
    opacity: 0.4,
  },
  dialog: { width: '100%', maxHeight: '90%' },
  dialogBody: { flexShrink: 1 },
  dialogScroll: { maxHeight: 360, flexShrink: 1 },
  heading: { ...typography.h3, color: colors.ink, marginBottom: spacing.md },
  label: {
    ...typography.bodyStrong,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  copy: { ...typography.body, color: colors.ink },
  helper: { ...typography.small, color: colors.muted, marginTop: spacing.sm },
  field: { marginBottom: spacing.lg },
  input: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 48,
  },
  choice: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: spacing.xs,
    minHeight: 48,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.cardWarm },
  disabled: { opacity: 0.55 },
  action: { marginVertical: spacing.md },
  success: { backgroundColor: colors.paid.bg },
  error: { backgroundColor: colors.unpaid.bg },
});
