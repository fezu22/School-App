import React from 'react';
import {Pressable, StyleSheet, Text, View, ViewStyle} from 'react-native';

import {colors, fonts} from '../../theme/hiraTheme';

type Tone = 'lime' | 'blue' | 'orange' | 'purple' | 'green' | 'danger';

const toneStyles: Record<Tone, {backgroundColor: string; color: string}> = {
  lime: {backgroundColor: colors.lime, color: colors.primary},
  blue: {backgroundColor: colors.softBlue, color: '#41617a'},
  orange: {backgroundColor: colors.softOrange, color: '#80513e'},
  purple: {backgroundColor: colors.softPurple, color: '#685b88'},
  green: {backgroundColor: '#e1f1e7', color: colors.success},
  danger: {backgroundColor: colors.dangerSoft, color: colors.danger},
};

export const HiraHeader = ({onOpenSettings}: {onOpenSettings: () => void}) => (
  <View style={styles.header}>
    <View style={styles.logo}><Text style={styles.logoText}>H</Text></View>
    <View style={styles.headerCopy}>
      <Text style={styles.workspaceLabel}>SUPER ADMIN WORKSPACE</Text>
      <Text style={styles.schoolName}>Overview</Text>
    </View>
    <View style={styles.bell}><Text style={styles.bellText}>!</Text><View style={styles.bellDot} /></View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      onPress={onOpenSettings}
      style={({pressed}) => [styles.menu, pressed && styles.pressed]}>
      <Text style={styles.menuText}>•••</Text>
    </Pressable>
  </View>
);

export const StatusPill = ({label, tone = 'green'}: {label: string; tone?: Tone}) => (
  <View style={[styles.pill, {backgroundColor: toneStyles[tone].backgroundColor}]}>
    <Text style={[styles.pillText, {color: toneStyles[tone].color}]}>{label}</Text>
  </View>
);

export const StatCard = ({label, value, hint, tone = 'lime'}: {label: string; value: string | number; hint: string; tone?: Tone}) => (
  <View style={[styles.statCard, {backgroundColor: toneStyles[tone].backgroundColor}]}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statHint}>{hint}</Text>
  </View>
);

export const SoftButton = ({label, onPress, tone = 'primary', disabled, style}: {label: string; onPress: () => void; tone?: 'primary' | 'soft' | 'danger'; disabled?: boolean; style?: ViewStyle}) => (
  <Pressable onPress={onPress} disabled={disabled} style={({pressed}) => [styles.button, styles[`button_${tone}`], disabled && styles.disabled, pressed && styles.pressed, style]}>
    <Text style={[styles.buttonText, styles[`buttonText_${tone}`]]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginBottom: 22},
  logo: {width: 46, height: 46, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  logoText: {fontFamily: fonts.display, color: colors.white, fontSize: 24},
  headerCopy: {flex: 1, marginLeft: 12},
  workspaceLabel: {fontFamily: fonts.bodySemiBold, color: colors.muted, fontSize: 9, letterSpacing: 1},
  schoolName: {fontFamily: fonts.heading, color: colors.ink, fontSize: 17, marginTop: 2},
  bell: {width: 39, height: 39, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginRight: 8},
  bellText: {fontFamily: fonts.heading, fontSize: 17, color: colors.primary, lineHeight: 19},
  bellDot: {position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#e15b5b', top: 7, right: 8},
  menu: {width: 39, height: 39, borderRadius: 14, backgroundColor: colors.softPurple, alignItems: 'center', justifyContent: 'center'},
  menuText: {fontFamily: fonts.heading, fontSize: 15, color: '#685b88', letterSpacing: 1, marginTop: -6},
  pill: {alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20},
  pillText: {fontFamily: fonts.bodySemiBold, fontSize: 11, letterSpacing: .2},
  statCard: {width: '48%', borderRadius: 20, padding: 16, minHeight: 136, justifyContent: 'space-between'},
  statLabel: {fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.ink},
  statValue: {fontFamily: fonts.display, fontSize: 31, color: colors.ink, letterSpacing: -.8, marginTop: 12},
  statHint: {fontFamily: fonts.body, fontSize: 11, color: colors.muted, marginTop: 4},
  button: {borderRadius: 15, minHeight: 42, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center'},
  button_primary: {backgroundColor: colors.primary},
  button_soft: {backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line},
  button_danger: {backgroundColor: colors.dangerSoft},
  buttonText: {fontFamily: fonts.bodySemiBold, fontSize: 13},
  buttonText_primary: {color: colors.white},
  buttonText_soft: {color: colors.primary},
  buttonText_danger: {color: colors.danger},
  disabled: {opacity: .55},
  pressed: {opacity: .82},
});
