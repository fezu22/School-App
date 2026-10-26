import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors, fonts } from '../../theme/hiraTheme';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {SuperAdminStackParamList} from '../../navigation/SuperAdminNavigator';
import {Button} from '../../components/hiraDashboard';

export default function SuperAdminSettingsScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<SuperAdminStackParamList>>();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.fullName?.trim().charAt(0).toUpperCase() || 'S'}
            </Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.name}>{user?.fullName || 'Super Admin'}</Text>
            <Text style={styles.email}>{user?.email || ''}</Text>
            <View style={styles.rolePill}>
              <Text style={styles.roleText}>SUPER ADMIN</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Text style={styles.description}>
            Your account access is managed by your organization administrator.
          </Text>
        </View>

        <Button title="Academic Setup" variant="secondary" onPress={() => navigation.navigate('AcademicSetup')} />
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log out of Super Admin account"
            onPress={logout}
            style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
          >
            <Text style={styles.logoutGlyph}>↪</Text>
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
          <Text style={styles.footerNote}>You will need to sign in again to continue.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.cream },
  content: { flex: 1, padding: 20 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18,
    backgroundColor: colors.white, borderRadius: 20, borderWidth: 1,
    borderColor: colors.line,
  },
  avatar: {
    width: 58, height: 58, borderRadius: 19, backgroundColor: colors.softBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display, fontSize: 25, color: colors.primary },
  profileCopy: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.heading, fontSize: 18, color: colors.ink },
  email: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  rolePill: {
    alignSelf: 'flex-start', marginTop: 7, paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: 10, backgroundColor: colors.softPurple,
  },
  roleText: { fontFamily: fonts.bodySemiBold, fontSize: 9, letterSpacing: 0.8, color: '#685b88' },
  section: {
    marginTop: 20, padding: 18, backgroundColor: colors.white,
    borderRadius: 18, borderWidth: 1, borderColor: colors.line,
  },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.ink },
  description: { marginTop: 7, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.muted },
  footer: { marginTop: 'auto', paddingTop: 20 },
  logoutButton: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 9, borderRadius: 15, borderWidth: 1, borderColor: '#efc5c1',
    backgroundColor: colors.dangerSoft,
  },
  logoutGlyph: { fontFamily: fonts.heading, fontSize: 20, color: colors.danger },
  logoutText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.danger },
  footerNote: { marginTop: 10, textAlign: 'center', fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  pressed: { opacity: 0.78 },
});
