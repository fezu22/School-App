import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme as t } from './theme/hiraTheme';
import { authRequest } from './shared/services/authRequest';

export default function UltraAdminScreen({ page = 'Home', previewOnly = false }) {
  const [overview, setOverview] = useState(null);
  const [schools, setSchools] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  // Provision school form
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [plan, setPlan] = useState('starter');
  const [superAdminFullName, setSuperAdminFullName] = useState('');
  const [superAdminEmail, setSuperAdminEmail] = useState('');
  const [superAdminPassword, setSuperAdminPassword] = useState('');

  const loadAll = useCallback(async () => {
    if (previewOnly) {
      setOverview(null);
      setSchools([]);
      setAuditLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [ov, sc, logs] = await Promise.all([
        authRequest('/ultra-admin/overview'),
        authRequest('/ultra-admin/schools'),
        authRequest('/ultra-admin/audit-logs'),
      ]);
      setOverview(ov?.data || ov || null);
      setSchools(Array.isArray(sc) ? sc : sc?.data || []);
      setAuditLogs(Array.isArray(logs) ? logs : logs?.data || []);
    } catch (failure) {
      setError(failure.message || 'Unable to load Ultra Admin platform data.');
    } finally {
      setLoading(false);
    }
  }, [previewOnly]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function provisionSchool() {
    if (previewOnly) return;
    setBusy('provision');
    setError('');
    setNotice('');
    try {
      const res = await authRequest('/ultra-admin/schools', {
        method: 'POST',
        body: JSON.stringify({
          name,
          code,
          plan,
          superAdminFullName,
          superAdminEmail,
          superAdminPassword,
        }),
      });
      const created = res?.data?.school || res?.school;
      if (created) setSchools(current => [created, ...current]);
      setName('');
      setCode('');
      setSuperAdminFullName('');
      setSuperAdminEmail('');
      setSuperAdminPassword('');
      setNotice('School and initial Super Admin provisioned.');
      await loadAll();
    } catch (failure) {
      setError(failure.message || 'Could not provision school.');
    } finally {
      setBusy('');
    }
  }

  async function toggleSchoolStatus(school) {
    if (previewOnly) return;
    const nextStatus = school.status === 'suspended' ? 'active' : 'suspended';
    setBusy(`status-${school.id}`);
    setError('');
    setNotice('');
    try {
      await authRequest(`/ultra-admin/schools/${encodeURIComponent(school.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStatus,
          reason: `Platform Ultra Admin changed status to ${nextStatus}`,
        }),
      });
      setNotice(`School ${school.name} is now ${nextStatus}.`);
      await loadAll();
    } catch (failure) {
      setError(failure.message || 'Could not update school status.');
    } finally {
      setBusy('');
    }
  }

  async function updateSubscription(school, nextPlan, nextStatus) {
    if (previewOnly) return;
    setBusy(`sub-${school.id}`);
    setError('');
    setNotice('');
    try {
      await authRequest(`/ultra-admin/schools/${encodeURIComponent(school.id)}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify({
          plan: nextPlan,
          subscriptionStatus: nextStatus,
        }),
      });
      setNotice(`Updated recorded subscription for ${school.name}.`);
      await loadAll();
    } catch (failure) {
      setError(failure.message || 'Could not update subscription.');
    } finally {
      setBusy('');
    }
  }

  const metrics = overview?.metrics || {};

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>ULTRA ADMIN PLATFORM AUTHORITY</Text>
      <Text style={styles.title}>
        {page === 'Home' ? 'Platform Governance' : page}
      </Text>
      <Text style={styles.subtitle}>
        Manage multi-school lifecycle, initial Super Admin provisioning, recorded subscription plans, and platform audit logs. Individual student records remain strictly isolated per school.
      </Text>

      {notice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {error ? (
        <View accessibilityRole="alert" style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={loadAll} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={t.primary} />
          <Text style={styles.subtitle}>Loading platform state…</Text>
        </View>
      ) : null}

      {page === 'Home' || page === 'Schools' ? (
        <>
          <View style={styles.metricsGrid}>
            {[
              ['Total Schools', metrics.totalSchools ?? schools.length],
              ['Active Schools', metrics.activeSchools ?? 0],
              ['Suspended', metrics.suspendedSchools ?? 0],
              ['Recorded Plans', metrics.recordedOnlySubscriptions ?? 0],
            ].map(([label, val]) => (
              <View key={label} style={styles.metricCard}>
                <Text style={styles.metricValue}>{val}</Text>
                <Text style={styles.metricLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {!previewOnly ? (
            <View style={styles.card}>
              <Text style={styles.sectionHeading}>Provision New School & Initial Super Admin</Text>
              <TextInput
                accessibilityLabel="School Name"
                value={name}
                onChangeText={setName}
                placeholder="School Name (e.g. Greenwood International)"
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="School Code"
                value={code}
                onChangeText={setCode}
                placeholder="School Code (e.g. GWI)"
                autoCapitalize="characters"
                style={styles.input}
              />
              <View style={styles.chipRow}>
                {['starter', 'growth', 'enterprise'].map(p => (
                  <Pressable
                    key={p}
                    accessibilityRole="button"
                    onPress={() => setPlan(p)}
                    style={[styles.chip, plan === p && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, plan === p && styles.chipTextActive]}>
                      {p.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel="Initial Super Admin Full Name"
                value={superAdminFullName}
                onChangeText={setSuperAdminFullName}
                placeholder="Initial Super Admin Full Name"
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Initial Super Admin Email"
                value={superAdminEmail}
                onChangeText={setSuperAdminEmail}
                placeholder="Initial Super Admin Email"
                autoCapitalize="none"
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Initial Super Admin Password"
                value={superAdminPassword}
                onChangeText={setSuperAdminPassword}
                placeholder="Initial Super Admin Password (min 10 chars)"
                secureTextEntry
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                disabled={busy === 'provision'}
                onPress={provisionSchool}
                style={[styles.primaryBtn, busy === 'provision' && styles.disabled]}
              >
                <Text style={styles.primaryBtnText}>
                  {busy === 'provision' ? 'Provisioning…' : 'Provision School'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}

      {page === 'Home' || page === 'Schools' || page === 'Subscriptions' ? (
        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionHeading}>Provisioned Schools & Subscription State</Text>
          {schools.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.metaText}>
                {previewOnly
                  ? 'Preview mode does not fabricate platform schools.'
                  : 'No schools provisioned yet.'}
              </Text>
            </View>
          ) : (
            schools.map(school => (
              <View key={school.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {school.name} ({school.code})
                </Text>
                <Text style={styles.metaText}>
                  Status: {school.status} · Plan: {school.plan?.toUpperCase()} · Subscription: {school.subscriptionStatus}
                </Text>
                <Text style={styles.metaText}>
                  Billing verification: {school.subscriptionVerification} (never faked without provider settlement)
                </Text>
                <Text style={styles.metaText}>
                  Usage: {school.usage?.branches ?? 0}/{school.usageLimits?.maxBranches ?? 0} branches · {school.usage?.staff ?? 0}/{school.usageLimits?.maxStaff ?? 0} staff · {school.usage?.students ?? 0}/{school.usageLimits?.maxStudents ?? 0} students
                </Text>
                {!previewOnly ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={!!busy}
                      onPress={() => toggleSchoolStatus(school)}
                      style={styles.secondaryBtn}
                    >
                      <Text style={styles.secondaryBtnText}>
                        {school.status === 'suspended' ? 'Restore School' : 'Suspend School'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={!!busy}
                      onPress={() =>
                        updateSubscription(
                          school,
                          school.plan === 'starter' ? 'growth' : 'enterprise',
                          'active_recorded',
                        )
                      }
                      style={styles.primaryBtnSmall}
                    >
                      <Text style={styles.primaryBtnText}>Record Plan Upgrade</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}

      {page === 'Home' || page === 'Platform Audit' ? (
        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionHeading}>Platform Audit Logs</Text>
          {auditLogs.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.metaText}>No platform audit events recorded yet.</Text>
            </View>
          ) : (
            auditLogs.map(entry => (
              <View key={entry.id} style={styles.card}>
                <Text style={styles.cardTitle}>{entry.action}</Text>
                <Text style={styles.metaText}>
                  Actor: {entry.actorUserId} · Target: {entry.targetId} ·{' '}
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: t.background },
  content: { padding: 20, paddingBottom: 36 },
  eyebrow: { color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { color: t.ink, fontSize: 26, fontWeight: '800', marginTop: 6 },
  subtitle: { color: t.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  metricCard: {
    flex: 1,
    minWidth: 130,
    backgroundColor: t.paper,
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    ...t.shadow,
  },
  metricValue: { color: t.ink, fontSize: 22, fontWeight: '800' },
  metricLabel: { color: t.muted, fontSize: 12, marginTop: 4 },
  card: {
    backgroundColor: t.paper,
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    ...t.shadow,
  },
  sectionHeading: { color: t.ink, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  cardTitle: { color: t.ink, fontSize: 15, fontWeight: '800' },
  metaText: { color: t.muted, fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: t.mutedContainer || '#F5F2EB',
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: t.ink,
    marginTop: 10,
    fontSize: 13,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: t.paper,
  },
  chipActive: { backgroundColor: t.primary, borderColor: t.primary },
  chipText: { color: t.muted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  primaryBtn: {
    backgroundColor: t.primary,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryBtnSmall: {
    backgroundColor: t.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  secondaryBtn: {
    borderColor: t.secondary || '#1E3A8A',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
    backgroundColor: t.paper,
  },
  secondaryBtnText: { color: t.secondary || '#1E3A8A', fontWeight: '700', fontSize: 13 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  noticeBox: { backgroundColor: '#CCFBF1', borderRadius: 14, padding: 12, marginTop: 12 },
  noticeText: { color: '#0F766E', fontSize: 13, fontWeight: '700' },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 14, padding: 12, marginTop: 12 },
  errorText: { color: '#B91C1C', fontSize: 13 },
  retryBtn: { marginTop: 8 },
  retryText: { color: t.primary, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
