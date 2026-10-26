import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radius, typography } from '../../theme/hiraDashboard';

type Variant = 'primary' | 'secondary' | 'danger';
type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  style?: ViewStyle;
  disabled?: boolean;
};

/** .btn / .btn.secondary / .btn.danger */
export function Button({
  title,
  onPress,
  variant = 'primary',
  style,
  disabled,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      <Text style={[styles.text, { color: textColor[variant] }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: 17,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  text: { ...typography.button },
});

const variantStyles: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primary },
  secondary: {
    backgroundColor: colors.cardWarm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  danger: { backgroundColor: colors.danger.bg },
};
const textColor: Record<Variant, string> = {
  primary: colors.white,
  secondary: colors.primary,
  danger: colors.danger.text,
};
