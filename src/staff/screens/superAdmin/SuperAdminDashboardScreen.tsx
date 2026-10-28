import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import {
  adminService,
  SuperAdminDashboard,
  SystemHealth,
  BackupStatus,
  UsageStatus,
  PrivilegedRequest,
  AutomationConfig,
  UserSession,
} from '../../services/admin/adminService';
import { SuperAdminStackParamList } from '../../navigation/SuperAdminNavigator';
import { HiraHeader, StatusPill } from '../../components/ui/HiraUI';
import { TeacherProvisioningCard } from './TeacherProvisioningCard';
import {
  HeroBanner,
  ScreenHeading,
  StatCard as DashboardStatCard,
  StatGrid,
} from '../../components/hiraDashboard';
import {
  cardShadow,
  colors as dashboardColors,
  typography as dashboardTypography,
} from '../../theme/hiraDashboard';
const colors = {
  cream: dashboardColors.background,
  line: dashboardColors.border,
  white: dashboardColors.white,
  primary: dashboardColors.primary,
  muted: dashboardColors.muted,
  ink: dashboardColors.ink,
  danger: dashboardColors.danger.text,
  dangerSoft: dashboardColors.danger.bg,
  success: dashboardColors.paid.text,
  softOrange: dashboardColors.pending.bg,
  softBlue: dashboardColors.soft,
  softPurple: dashboardColors.leave.bg,
};
const fonts = {
  body: dashboardTypography.body.fontFamily,
  bodyMedium: dashboardTypography.body.fontFamily,
  bodySemiBold: dashboardTypography.bodyStrong.fontFamily,
  display: dashboardTypography.bigNumber.fontFamily,
  heading: dashboardTypography.h3.fontFamily,
};

const SuperAdminDashboardScreen = () => {
  const { user, accessToken } = useAuth();

  const navigation =
    useNavigation<NativeStackNavigationProp<SuperAdminStackParamList>>();

  const [dashboard, setDashboard] = useState<SuperAdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [privilegedRequests, setPrivilegedRequests] = useState<
    PrivilegedRequest[]
  >([]);
  const [automations, setAutomations] = useState<AutomationConfig[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);

  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const reviewInFlightRef = useRef(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [requestErrors, setRequestErrors] = useState<
    Record<string, { message: string; lastStatus: 'approved' | 'rejected' }>
  >({});
  const [automationErrors, setAutomationErrors] = useState<
    Record<string, { message: string; lastPaused: boolean }>
  >({});
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>(
    {},
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'inactive'
  >('all');
  const [activeTab, setActiveTab] = useState<
    'home' | 'operations' | 'administration'
  >('home');
  const scrollViewRef = useRef<ScrollView>(null);
  const branchesSectionYRef = useRef(0);

  const scrollToBranches = () => {
    scrollViewRef.current?.scrollTo({
      y: Math.max(0, branchesSectionYRef.current - 10),
      animated: true,
    });
  };

  const loadDashboard = useCallback(async () => {
    if (!accessToken) {
      setError('Authentication token is missing');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSectionErrors({});

      const [
        dashboardResponse,
        healthResponse,
        backupResponse,
        usageResponse,
        privilegedRequestsResponse,
        automationsResponse,
        sessionsResponse,
      ] = await Promise.allSettled([
        adminService.getDashboard(accessToken),
        adminService.getSystemHealth(accessToken),
        adminService.getBackupStatus(accessToken),
        adminService.getUsageStatus(accessToken),
        adminService.getPendingPrivilegedRequests(accessToken),
        adminService.getAutomations(accessToken),
        adminService.getSessions(accessToken),
      ]);

      if (dashboardResponse.status === 'rejected') throw dashboardResponse.reason;
      setDashboard(dashboardResponse.value.data);
      setHealth(
        healthResponse.status === 'fulfilled' ? healthResponse.value.data : null,
      );
      setBackup(
        backupResponse.status === 'fulfilled' ? backupResponse.value.data : null,
      );
      setUsage(
        usageResponse.status === 'fulfilled' ? usageResponse.value.data : null,
      );
      setPrivilegedRequests(
        privilegedRequestsResponse.status === 'fulfilled'
          ? privilegedRequestsResponse.value.data.requests
          : [],
      );
      setAutomations(
        automationsResponse.status === 'fulfilled'
          ? automationsResponse.value.data.automations
          : [],
      );
      setSessions(
        sessionsResponse.status === 'fulfilled'
          ? sessionsResponse.value.data.sessions
          : [],
      );
      const failures: Record<string, string> = {};
      const sections = {
        'System Health': healthResponse,
        'Backup Alerts': backupResponse,
        'Usage Limits': usageResponse,
        'Pending Privileged Requests': privilegedRequestsResponse,
        'Automation Controls': automationsResponse,
        'Session Security Controls': sessionsResponse,
      };
      for (const [name, response] of Object.entries(sections)) {
        if (response.status === 'rejected') {
          failures[name] =
            response.reason instanceof Error
              ? response.reason.message
              : 'This section is unavailable.';
        }
      }
      setSectionErrors(failures);
      if (Object.keys(failures).length) {
        setError(`Some sections could not load: ${Object.keys(failures).join(', ')}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleReviewRequest = async (
    requestId: string,
    status: 'approved' | 'rejected',
  ) => {
    if (!accessToken || reviewInFlightRef.current) return;

    try {
      reviewInFlightRef.current = true;
      setReviewingId(requestId);
      setFeedbackMessage('');
      setRequestErrors(prev => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });

      const res = await adminService.reviewPrivilegedRequest(
        accessToken,
        requestId,
        status,
      );

      if (
        res.success &&
        res.data?._id === requestId &&
        res.data.status === status
      ) {
        setPrivilegedRequests(prev =>
          prev.filter(req => req._id !== requestId),
        );
        setFeedbackMessage(res.message || `Request successfully ${status}.`);
      } else {
        const errMsg = res.success
          ? 'The server did not confirm the requested decision. The request remains pending.'
          : res.message || 'Failed to review request';
        setRequestErrors(prev => ({
          ...prev,
          [requestId]: { message: errMsg, lastStatus: status },
        }));
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Error reviewing request';
      setRequestErrors(prev => ({
        ...prev,
        [requestId]: { message: errMsg, lastStatus: status },
      }));
    } finally {
      reviewInFlightRef.current = false;
      setReviewingId(null);
    }
  };

  const confirmReviewRequest = (
    request: PrivilegedRequest,
    status: 'approved' | 'rejected',
  ) => {
    Alert.alert(
      `${status === 'approved' ? 'Approve' : 'Reject'} request`,
      `${request.requestType}: ${request.reason}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: status === 'approved' ? 'Approve' : 'Reject',
          style: status === 'rejected' ? 'destructive' : 'default',
          onPress: () => handleReviewRequest(request._id, status),
        },
      ],
    );
  };

  const handleToggleAutomation = async (
    key: string,
    currentPaused: boolean,
  ) => {
    if (!accessToken || togglingKey) return;

    try {
      setTogglingKey(key);
      setFeedbackMessage('');
      setAutomationErrors(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      const res = await adminService.toggleAutomationPause(
        accessToken,
        key,
        !currentPaused,
      );

      if (
        res.success &&
        res.data?.key === key &&
        res.data.isPaused === !currentPaused
      ) {
        setAutomations(prev =>
          prev.map(auto => (auto.key === key ? res.data : auto)),
        );
        setFeedbackMessage(`Pause configuration for "${res.data.name}" saved.`);
      } else {
        const errMsg = res.message || 'Failed to update automation';
        setAutomationErrors(prev => ({
          ...prev,
          [key]: { message: errMsg, lastPaused: currentPaused },
        }));
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Error updating automation';
      setAutomationErrors(prev => ({
        ...prev,
        [key]: { message: errMsg, lastPaused: currentPaused },
      }));
    } finally {
      setTogglingKey(null);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!accessToken || revokingId) return;

    try {
      setRevokingId(sessionId);
      setFeedbackMessage('');
      setSessionErrors(prev => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });

      const res = await adminService.revokeSession(accessToken, sessionId);

      if (res.success && res.data?._id === sessionId && res.data.isRevoked) {
        setSessions(prev =>
          prev.map(sess => (sess._id === sessionId ? res.data : sess)),
        );
        setFeedbackMessage('Session successfully revoked.');
      } else {
        const errMsg = res.message || 'Failed to revoke session';
        setSessionErrors(prev => ({
          ...prev,
          [sessionId]: errMsg,
        }));
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Error revoking session';
      setSessionErrors(prev => ({
        ...prev,
        [sessionId]: errMsg,
      }));
    } finally {
      setRevokingId(null);
    }
  };

  const confirmAutomationSetting = (automation: AutomationConfig) => {
    const nextPaused = !automation.isPaused;
    Alert.alert(
      nextPaused ? 'Save pause setting' : 'Clear pause setting',
      'This updates stored configuration only; no automation worker is connected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextPaused ? 'Save pause setting' : 'Clear pause setting',
          onPress: () =>
            handleToggleAutomation(automation.key, automation.isPaused),
        },
      ],
    );
  };

  const confirmSessionRevocation = (session: UserSession) => {
    Alert.alert(
      'Revoke session',
      `Revoke access for ${session.userId?.fullName ?? 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => handleRevokeSession(session._id),
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0066cc" />
        <Text style={styles.statusText}>Loading dashboard...</Text>
      </View>
    );
  }

  if (error && !dashboard) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadDashboard}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!dashboard) {
    return (
      <View style={styles.center}>
        <Text>No dashboard data available.</Text>
      </View>
    );
  }

  const { branches } = dashboard;

  const filteredBranches = branches.list.filter(branch => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query === '' ||
      branch.name.toLowerCase().includes(query) ||
      branch.code.toLowerCase().includes(query);

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'active'
        ? branch.isActive
        : !branch.isActive;

    return matchesSearch && matchesStatus;
  });

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <HiraHeader
          onOpenSettings={() => navigation.navigate('SuperAdminSettings')}
        />

        <ScreenHeading
          title="Super Admin overview"
          subtitle={
            'Hello, ' +
            (user?.fullName?.split(' ')[0] ?? 'Admin') +
            ' - your school network at a glance'
          }
        />
        {error !== '' && dashboard !== null && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButtonBanner}
              onPress={loadDashboard}
            >
              <Text style={styles.retryButtonBannerText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {feedbackMessage !== '' && (
          <View style={styles.feedbackBanner}>
            <Text style={styles.feedbackText}>{feedbackMessage}</Text>
          </View>
        )}

        {activeTab === 'home' && (
          <>
            <HeroBanner
              roleLabel="SUPER ADMIN"
              dateLabel={new Date().toLocaleDateString('en-PK', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
              bigValue={branches.total}
              bigValueCaption="assigned branches"
              title="Your school network"
              subtitle="Review network health and keep every branch moving forward."
              actionLabel="Explore branches"
              onActionPress={scrollToBranches}
            />

            <Text style={styles.overviewTitle}>Network overview</Text>
            <StatGrid>
              <DashboardStatCard
                icon={String.fromCharCode(10003)}
                label="Active branches"
                value={branches.active}
                foot="Currently active"
                accentIndex={1}
              />
              <DashboardStatCard
                icon="!"
                label="Inactive branches"
                value={branches.inactive}
                foot="Currently inactive"
                accentIndex={2}
              />
            </StatGrid>

            <View
              style={styles.section}
              onLayout={event => {
                branchesSectionYRef.current = event.nativeEvent.layout.y;
              }}
            >
              <Text style={styles.sectionTitle}>Assigned Branches</Text>

              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or code..."
                placeholderTextColor="#888888"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
              />

              <View style={styles.filterContainer}>
                {(['all', 'active', 'inactive'] as const).map(filter => (
                  <TouchableOpacity
                    key={filter}
                    style={[
                      styles.filterButton,
                      statusFilter === filter && styles.filterButtonActive,
                    ]}
                    onPress={() => setStatusFilter(filter)}
                  >
                    <Text
                      style={[
                        styles.filterButtonText,
                        statusFilter === filter &&
                          styles.filterButtonTextActive,
                      ]}
                    >
                      {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {filteredBranches.length === 0 ? (
                <Text style={styles.empty}>No branches found.</Text>
              ) : (
                filteredBranches.map(branch => (
                  <View key={branch._id} style={styles.branchCard}>
                    <Text style={styles.branchName}>{branch.name}</Text>
                    <Text style={styles.branchCode}>{branch.code}</Text>
                    <Text style={styles.branchInfo}>
                      {branch.city} • {branch.address}
                    </Text>
                    <StatusPill
                      label={branch.isActive ? 'Active' : 'Inactive'}
                      tone={branch.isActive ? 'green' : 'orange'}
                    />

                    {hasPermission(user?.role, PERMISSIONS.BRANCHES_VIEW) && (
                      <TouchableOpacity
                        style={styles.viewButton}
                        onPress={() =>
                          navigation.navigate('SuperAdminBranchDetails', {
                            branchId: branch._id,
                          })
                        }
                      >
                        <Text style={styles.viewButtonText}>View Branch</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </View>
          </>
        )}

        {activeTab === 'operations' && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>System Health</Text>
              {sectionErrors['System Health'] ? (
                <Text style={styles.error}>{sectionErrors['System Health']}</Text>
              ) : null}

              <View style={styles.healthCard}>
                <Text style={styles.healthTitle}>API</Text>
                <Text style={styles.healthStatus}>
                  {health?.api.status.toUpperCase()}
                </Text>
                <Text style={styles.healthMessage}>{health?.api.message}</Text>
              </View>

              <View style={styles.healthCard}>
                <Text style={styles.healthTitle}>Database</Text>
                <Text style={styles.healthStatus}>
                  {health?.database.status.toUpperCase()}
                </Text>
                <Text style={styles.healthMessage}>
                  {health?.database.message}
                </Text>
              </View>

              <View style={styles.healthCard}>
                <Text style={styles.healthTitle}>Overall</Text>
                <Text style={styles.healthStatus}>
                  {health?.overall.toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Backup Alerts</Text>
              {sectionErrors['Backup Alerts'] ? (
                <Text style={styles.error}>{sectionErrors['Backup Alerts']}</Text>
              ) : null}

              <View style={styles.healthCard}>
                <Text style={styles.healthTitle}>Backup Monitoring</Text>
                <Text style={styles.healthStatus}>
                  {backup?.status.replace('_', ' ').toUpperCase()}
                </Text>
                <Text style={styles.healthMessage}>{backup?.message}</Text>
                <Text style={styles.healthMessage}>
                  Last successful backup:{' '}
                  {backup?.lastSuccessfulBackup ?? 'Not available'}
                </Text>
                <Text style={styles.healthMessage}>
                  Next scheduled backup:{' '}
                  {backup?.nextScheduledBackup ?? 'Not available'}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Usage Limits</Text>

              {usage ? (
                <>
                  <View style={styles.healthCard}>
                    <Text style={styles.healthTitle}>Branches</Text>
                    <Text style={styles.value}>{usage.branches.used}</Text>
                    <Text style={styles.label}>
                      Limit:{' '}
                      {usage.branches.limit === null
                        ? 'Not configured'
                        : usage.branches.limit}
                    </Text>
                    <Text style={styles.statusText}>
                      Status: {usage.branches.status}
                    </Text>
                  </View>

                  <View style={styles.healthCard}>
                    <Text style={styles.healthTitle}>Users</Text>
                    <Text style={styles.value}>{usage.users.used}</Text>
                    <Text style={styles.label}>
                      Limit:{' '}
                      {usage.users.limit === null
                        ? 'Not configured'
                        : usage.users.limit}
                    </Text>
                    <Text style={styles.statusText}>
                      Status: {usage.users.status}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.empty}>
                  {sectionErrors['Usage Limits'] || 'Usage data not available.'}
                </Text>
              )}
            </View>
          </>
        )}

        {activeTab === 'administration' && (
          <>
            {hasPermission(user?.role, PERMISSIONS.TIMETABLE_MANAGE) ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Academic Management</Text>
                {hasPermission(user?.role, PERMISSIONS.ACADEMIC_ROOMS_VIEW) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Rooms" style={styles.toolCard} onPress={() => navigation.navigate('Rooms')}><Text style={styles.toolCardTitle}>Rooms</Text><Text style={styles.toolCardText}>Manage physical school rooms and resources.</Text></TouchableOpacity> : null}
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Manage Timetable"
                  style={styles.toolCard}
                  onPress={() => navigation.navigate('TimetableAdmin')}
                >
                  <Text style={styles.toolCardTitle}>Manage Timetable</Text>
                  <Text style={styles.toolCardText}>
                    Plan weekly periods, review complete schedule drafts and approve publication.
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TeacherProvisioningCard
              onCreate={() => navigation.navigate('CreateTeacher')}
              onAssign={() => navigation.navigate('AssignTeacher')}
            />
            {hasPermission(user?.role, PERMISSIONS.PRINCIPALS_MANAGE) && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Principal administration
                </Text>
                <TouchableOpacity
                  style={[styles.toolCard, styles.toolCardPrimary]}
                  onPress={() => navigation.navigate('CreatePrincipal')}
                >
                  <Text style={styles.toolCardTitle}>Create Principal</Text>
                  <Text style={styles.toolCardText}>
                    Create a principal account and assign a school branch.
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {hasPermission(
              user?.role,
              PERMISSIONS.PRIVILEGED_REQUESTS_MANAGE,
            ) && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Pending Privileged Requests
                </Text>

                {sectionErrors['Pending Privileged Requests'] ? (
                  <Text style={styles.error}>
                    {sectionErrors['Pending Privileged Requests']}
                  </Text>
                ) : privilegedRequests.length === 0 ? (
                  <View style={styles.card}>
                    <Text style={styles.empty}>
                      No pending privileged requests
                    </Text>
                  </View>
                ) : (
                  privilegedRequests.map(request => {
                    const isProcessing = reviewingId === request._id;
                    const reviewInProgress = reviewingId !== null;
                    const reqErr = requestErrors[request._id];
                    return (
                      <View key={request._id} style={styles.card}>
                        <Text style={styles.cardTitle}>
                          {request.requestType}
                        </Text>
                        <Text style={styles.label}>
                          Requester:{' '}
                          {request.requesterId?.fullName ?? 'Unknown'}
                        </Text>
                        <Text style={styles.label}>
                          Role: {request.requesterId?.role ?? 'Unknown'}
                        </Text>
                        {request.branchId && (
                          <Text style={styles.label}>
                            Branch: {request.branchId.name} (
                            {request.branchId.code})
                          </Text>
                        )}
                        <Text style={styles.label}>
                          Reason: {request.reason}
                        </Text>
                        <Text style={styles.statusText}>
                          Status: {request.status}
                        </Text>

                        {reqErr && (
                          <View style={styles.actionErrorBanner}>
                            <Text style={styles.actionErrorText}>
                              {reqErr.message}
                            </Text>
                            <TouchableOpacity
                              style={styles.inlineRetryButton}
                              disabled={reviewInProgress}
                              onPress={() =>
                                handleReviewRequest(
                                  request._id,
                                  reqErr.lastStatus,
                                )
                              }
                            >
                              <Text style={styles.inlineRetryText}>
                                Retry{' '}
                                {reqErr.lastStatus === 'approved'
                                  ? 'Approve'
                                  : 'Reject'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        <View style={styles.actionRow}>
                          <TouchableOpacity
                            style={[
                              styles.approveButton,
                              reviewInProgress && styles.buttonDisabled,
                            ]}
                            disabled={reviewInProgress}
                            onPress={() =>
                              confirmReviewRequest(request, 'approved')
                            }
                          >
                            {isProcessing ? (
                              <ActivityIndicator color="#ffffff" size="small" />
                            ) : (
                              <Text style={styles.buttonText}>Approve</Text>
                            )}
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.rejectButton,
                              reviewInProgress && styles.buttonDisabled,
                            ]}
                            disabled={reviewInProgress}
                            onPress={() =>
                              confirmReviewRequest(request, 'rejected')
                            }
                          >
                            {isProcessing ? (
                              <ActivityIndicator color="#ffffff" size="small" />
                            ) : (
                              <Text style={styles.buttonText}>Reject</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </>
        )}

        {activeTab === 'operations' &&
          hasPermission(user?.role, PERMISSIONS.AUTOMATIONS_MANAGE) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Automation configuration</Text>
              <Text style={styles.statusText}>
                These settings are stored, but no automation worker is
                connected.
              </Text>

              {sectionErrors['Automation Controls'] ? (
                <Text style={styles.error}>
                  {sectionErrors['Automation Controls']}
                </Text>
              ) : automations.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.empty}>No automations configured</Text>
                </View>
              ) : (
                automations.map(auto => {
                  const isProcessing = togglingKey === auto.key;
                  const autoErr = automationErrors[auto.key];

                  return (
                    <View key={auto._id} style={styles.card}>
                      <Text style={styles.cardTitle}>{auto.name}</Text>
                      <Text style={styles.label}>{auto.description}</Text>

                      <View style={styles.badgeRow}>
                        <Text
                          style={[
                            styles.badge,
                            auto.isPaused
                              ? styles.badgePaused
                              : styles.badgeActive,
                          ]}
                        >
                          {auto.isPaused ? 'PAUSED' : 'ACTIVE'}
                        </Text>
                      </View>

                      {autoErr && (
                        <View style={styles.actionErrorBanner}>
                          <Text style={styles.actionErrorText}>
                            {autoErr.message}
                          </Text>
                          <TouchableOpacity
                            style={styles.inlineRetryButton}
                            disabled={isProcessing}
                            onPress={() =>
                              handleToggleAutomation(
                                auto.key,
                                autoErr.lastPaused,
                              )
                            }
                          >
                            <Text style={styles.inlineRetryText}>Retry</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      <TouchableOpacity
                        style={[
                          auto.isPaused
                            ? styles.resumeButton
                            : styles.pauseButton,
                          isProcessing && styles.buttonDisabled,
                        ]}
                        disabled={isProcessing}
                        onPress={() => confirmAutomationSetting(auto)}
                      >
                        {isProcessing ? (
                          <ActivityIndicator color="#ffffff" size="small" />
                        ) : (
                          <Text style={styles.buttonText}>
                            {auto.isPaused
                              ? 'Clear pause setting'
                              : 'Save pause setting'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </View>
          )}

        {activeTab === 'administration' &&
          hasPermission(user?.role, PERMISSIONS.SESSIONS_MANAGE) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Session Security Controls</Text>

              {sectionErrors['Session Security Controls'] ? (
                <Text style={styles.error}>
                  {sectionErrors['Session Security Controls']}
                </Text>
              ) : sessions.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.empty}>No active sessions</Text>
                </View>
              ) : (
                sessions.map(sess => {
                  const isProcessing = revokingId === sess._id;
                  const sessErr = sessionErrors[sess._id];

                  return (
                    <View key={sess._id} style={styles.card}>
                      <Text style={styles.cardTitle}>
                        User: {sess.userId?.fullName ?? 'Unknown'}
                      </Text>
                      <Text style={styles.label}>
                        Email: {sess.userId?.email ?? 'N/A'}
                      </Text>
                      <Text style={styles.label}>Role: {sess.role}</Text>
                      <Text style={styles.label}>
                        Session ID: {sess._id.substring(0, 10)}...
                      </Text>

                      <View style={styles.badgeRow}>
                        <Text
                          style={[
                            styles.badge,
                            sess.isRevoked
                              ? styles.badgeRevoked
                              : styles.badgeActive,
                          ]}
                        >
                          {sess.isRevoked ? 'REVOKED' : 'ACTIVE'}
                        </Text>
                      </View>

                      {sessErr && (
                        <View style={styles.actionErrorBanner}>
                          <Text style={styles.actionErrorText}>{sessErr}</Text>
                          <TouchableOpacity
                            style={styles.inlineRetryButton}
                            disabled={isProcessing}
                            onPress={() =>
                              Alert.alert(
                                'Revoke session',
                                `Revoke access for ${
                                  sess.userId?.fullName ?? 'this user'
                                }?`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Revoke',
                                    style: 'destructive',
                                    onPress: () =>
                                      handleRevokeSession(sess._id),
                                  },
                                ],
                              )
                            }
                          >
                            <Text style={styles.inlineRetryText}>Retry</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {!sess.isRevoked && (
                        <TouchableOpacity
                          style={[
                            styles.revokeButton,
                            isProcessing && styles.buttonDisabled,
                          ]}
                          disabled={isProcessing}
                          onPress={() => confirmSessionRevocation(sess)}
                        >
                          {isProcessing ? (
                            <ActivityIndicator color="#ffffff" size="small" />
                          ) : (
                            <Text style={styles.buttonText}>
                              Revoke Session
                            </Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          )}
      </ScrollView>
      <SafeAreaView
        edges={['bottom', 'left', 'right']}
        style={styles.bottomSafeArea}
      >
        <View style={styles.bottomBar}>
          {(
            [
              ['home', 'Home', '▦'],
              ['operations', 'Operations', '◴'],
              ['administration', 'Administration', '⚙'],
            ] as const
          ).map(([tab, label, icon]) => {
            const selected = activeTab === tab;
            return (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={label}
                onPress={() => setActiveTab(tab)}
                style={styles.bottomTabButton}
              >
                <View
                  style={[
                    styles.bottomTabPill,
                    selected && styles.bottomTabPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.bottomTabIcon,
                      selected && styles.bottomTabTextActive,
                    ]}
                  >
                    {icon}
                  </Text>
                  <Text
                    style={[
                      styles.bottomTabLabel,
                      selected && styles.bottomTabTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f5f6fa',
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
  },

  feedbackBanner: {
    backgroundColor: '#e3f2fd',
    borderColor: '#90caf9',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },

  feedbackText: {
    color: '#1565c0',
    fontWeight: '600',
    fontSize: 14,
    textAlign: 'center',
  },

  card: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },

  value: {
    fontSize: 32,
    fontWeight: '700',
    marginTop: 8,
  },

  label: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },

  section: {
    marginTop: 8,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },

  branchCard: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },

  branchName: {
    fontSize: 18,
    fontWeight: '700',
  },

  branchCode: {
    fontSize: 14,
    marginTop: 4,
    fontWeight: '600',
  },

  branchInfo: {
    fontSize: 14,
    color: '#666666',
    marginTop: 8,
  },

  branchStatus: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },

  empty: {
    color: '#666666',
  },

  statusText: {
    marginTop: 10,
  },

  error: {
    color: '#d32f2f',
    textAlign: 'center',
    fontSize: 16,
  },

  healthCard: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },

  healthTitle: {
    fontSize: 16,
    fontWeight: '700',
  },

  healthStatus: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },

  healthMessage: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },

  viewButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#eeeeee',
  },

  viewButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },

  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 10,
  },

  approveButton: {
    flex: 1,
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  rejectButton: {
    flex: 1,
    backgroundColor: '#c62828',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  pauseButton: {
    marginTop: 12,
    backgroundColor: '#e65100',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  resumeButton: {
    marginTop: 12,
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  revokeButton: {
    marginTop: 12,
    backgroundColor: '#b71c1c',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },

  badgeRow: {
    marginTop: 8,
    flexDirection: 'row',
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },

  badgeActive: {
    backgroundColor: '#e8f5e9',
    color: '#2e7d32',
  },

  badgePaused: {
    backgroundColor: '#fff3e0',
    color: '#e65100',
  },

  badgeRevoked: {
    backgroundColor: '#e45469',
    color: '#c62828',
  },

  searchInput: {
    backgroundColor: '#ffffff',
    borderColor: '#cccccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333333',
    marginBottom: 12,
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#eeeeee',
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: '#0066cc',
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
  },
  filterButtonTextActive: {
    color: '#ffffff',
  },

  retryButton: {
    marginTop: 16,
    backgroundColor: '#0066cc',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: '#ffebee',
    borderColor: '#ef5350',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorBannerText: {
    color: '#c62828',
    fontWeight: '600',
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  retryButtonBanner: {
    backgroundColor: '#c62828',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  retryButtonBannerText: {
    color: '#c91a1a',
    fontWeight: '600',
    fontSize: 12,
  },
  actionErrorBanner: {
    backgroundColor: '#ed8292',
    borderColor: '#ef5350',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionErrorText: {
    color: '#c62828',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  inlineRetryButton: {
    backgroundColor: '#c62828',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  inlineRetryText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  ...baseStyles,
  safeArea: { flex: 1, backgroundColor: dashboardColors.background },
  scroll: { flex: 1, backgroundColor: dashboardColors.background },
  container: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
    backgroundColor: dashboardColors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    backgroundColor: dashboardColors.background,
  },
  statusText: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 14,
    marginTop: 10,
  },
  title: { fontFamily: fonts.display, color: colors.ink },
  nextStepsCard: {
    backgroundColor: dashboardColors.card,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: dashboardColors.border,
    padding: 17,
    marginBottom: 16,
    ...cardShadow,
  },
  nextStepsTitle: {
    ...dashboardTypography.h3,
    color: dashboardColors.ink,
    marginBottom: 10,
  },
  nextStepsActions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  attentionButton: {
    backgroundColor: '#4b5bbb',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  attentionButtonText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.white,
    fontSize: 12,
  },
  outlineAction: {
    borderWidth: 1,
    borderColor: '#e6dcca',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#fffdf9',
  },
  outlineActionText: {
    fontFamily: fonts.bodySemiBold,
    color: '#4b5bbb',
    fontSize: 12,
  },
  nextStepsLowerRow: { marginTop: 9, alignItems: 'flex-start' },
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  greeting: {
    fontFamily: fonts.display,
    fontSize: 27,
    lineHeight: 33,
    letterSpacing: -1,
    color: colors.ink,
    maxWidth: 270,
  },
  greetingCaption: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
    maxWidth: 290,
  },
  dateChip: {
    backgroundColor: colors.softPurple,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginTop: 5,
  },
  dateChipText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.6,
    color: '#685b88',
  },
  bottomSafeArea: {
    backgroundColor: dashboardColors.card,
    borderTopWidth: 1,
    borderTopColor: '#ede4d9',
  },
  bottomBar: {
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    backgroundColor: dashboardColors.card,
  },
  bottomTabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  bottomTabPill: {
    minWidth: 76,
    minHeight: 54,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bottomTabPillActive: { backgroundColor: dashboardColors.soft },
  bottomTabIcon: { fontSize: 18, lineHeight: 21, color: dashboardColors.muted },
  bottomTabLabel: {
    ...dashboardTypography.caption,
    color: dashboardColors.muted,
  },
  bottomTabTextActive: { color: dashboardColors.primary },
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  toolCard: {
    width: '48%',
    minHeight: 132,
    padding: 17,
    borderRadius: 17,
    borderWidth: 1,
    ...cardShadow,
  },
  toolCardPrimary: {
    backgroundColor: dashboardColors.soft,
    borderColor: dashboardColors.softBorder,
  },
  toolCardSecondary: {
    backgroundColor: dashboardColors.card,
    borderColor: dashboardColors.border,
  },
  toolCardTitle: {
    ...dashboardTypography.h3,
    color: dashboardColors.ink,
    marginBottom: 8,
  },
  toolCardText: {
    ...dashboardTypography.small,
    fontSize: 12,
    color: dashboardColors.muted,
  },
  heroCard: {
    backgroundColor: '#ffe2a0',
    borderRadius: 24,
    minHeight: 214,
    padding: 18,
    overflow: 'hidden',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#f4d58f',
  },
  heroBackgroundImage: { borderRadius: 23 },
  heroImageFade: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '66%',
    backgroundColor: '#ffe2a0',
    opacity: 0.9,
  },
  heroContent: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroSun: {
    position: 'absolute',
    right: 42,
    top: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff5c9',
  },
  heroCloudOne: {
    position: 'absolute',
    right: 12,
    top: 54,
    width: 64,
    height: 20,
    borderRadius: 12,
    backgroundColor: '#fff1c0',
    opacity: 0.8,
  },
  heroCloudTwo: {
    position: 'absolute',
    right: 72,
    top: 68,
    width: 40,
    height: 14,
    borderRadius: 9,
    backgroundColor: '#fff1c0',
    opacity: 0.65,
  },
  schoolIllustration: {
    position: 'absolute',
    right: -3,
    bottom: 4,
    width: 157,
    height: 128,
    alignItems: 'center',
  },
  schoolRoof: {
    width: 108,
    height: 37,
    backgroundColor: '#f39a75',
    transform: [{ rotate: '45deg' }],
    borderTopLeftRadius: 8,
    position: 'absolute',
    top: 13,
  },
  schoolBody: {
    width: 121,
    height: 70,
    backgroundColor: '#fff8e5',
    borderRadius: 7,
    position: 'absolute',
    bottom: 25,
    borderWidth: 3,
    borderColor: '#edb266',
  },
  schoolDoor: {
    position: 'absolute',
    width: 22,
    height: 35,
    backgroundColor: '#7e705e',
    bottom: 0,
    left: 47,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  schoolWindow: {
    position: 'absolute',
    width: 20,
    height: 18,
    backgroundColor: colors.softBlue,
    top: 14,
    left: 15,
    borderRadius: 3,
  },
  schoolWindowRight: {
    position: 'absolute',
    width: 20,
    height: 18,
    backgroundColor: colors.softBlue,
    top: 14,
    right: 15,
    borderRadius: 3,
  },
  schoolPath: {
    position: 'absolute',
    width: 130,
    height: 16,
    backgroundColor: '#efc77c',
    bottom: 10,
    borderRadius: 12,
    transform: [{ rotate: '-6deg' }],
  },
  heroKicker: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 1.2,
    color: '#9a7442',
  },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: -0.5,
    color: colors.ink,
    marginTop: 8,
    maxWidth: 190,
  },
  heroCopy: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: '#716b5d',
    marginTop: 8,
    maxWidth: 183,
  },
  heroPrimaryAction: {
    backgroundColor: '#4b5bbb',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  heroPrimaryActionText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.white,
    fontSize: 11,
  },
  overviewTitle: {
    ...dashboardTypography.h3,
    color: dashboardColors.ink,
    marginBottom: 13,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 22,
  },
  section: {
    marginTop: 0,
    marginBottom: 16,
    padding: 17,
    backgroundColor: dashboardColors.card,
    borderColor: dashboardColors.border,
    borderWidth: 1,
    borderBottomWidth: 4,
    borderBottomColor: dashboardColors.shadowSolid,
    borderRadius: 17,
    ...cardShadow,
  },
  sectionTitle: {
    ...dashboardTypography.h3,
    color: dashboardColors.ink,
    marginBottom: 12,
  },
  card: {
    backgroundColor: dashboardColors.card,
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: dashboardColors.border,
    ...cardShadow,
  },
  cardTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.ink },
  value: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.ink,
    marginTop: 7,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    marginTop: 4,
  },
  branchCard: {
    backgroundColor: dashboardColors.cardWarm,
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: dashboardColors.border,
    ...cardShadow,
  },
  branchName: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink },
  branchCode: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.primary,
    marginTop: 5,
  },
  branchInfo: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 10,
  },
  branchStatus: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.success,
    marginTop: 8,
  },
  healthCard: {
    backgroundColor: dashboardColors.card,
    padding: 15,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: dashboardColors.border,
  },
  healthTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.ink },
  healthStatus: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.primary,
    marginTop: 8,
  },
  healthMessage: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    marginTop: 5,
  },
  searchInput: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    marginBottom: 11,
  },
  filterContainer: { flexDirection: 'row', marginBottom: 14, gap: 8 },
  filterButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.muted,
  },
  filterButtonTextActive: { color: colors.white },
  viewButton: {
    marginTop: 14,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: colors.softBlue,
  },
  viewButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.primary,
  },
  actionRow: { flexDirection: 'row', marginTop: 14, gap: 10 },
  approveButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
  },
  rejectButton: {
    flex: 1,
    backgroundColor: colors.dangerSoft,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
  },
  pauseButton: {
    marginTop: 14,
    backgroundColor: colors.softOrange,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
  },
  resumeButton: {
    marginTop: 14,
    backgroundColor: colors.primary,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
  },
  revokeButton: {
    marginTop: 14,
    backgroundColor: colors.dangerSoft,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.white,
    fontSize: 13,
  },
  buttonDisabled: { opacity: 0.55 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    overflow: 'hidden',
  },
  badgeActive: { backgroundColor: '#e1f1e7', color: colors.success },
  badgePaused: { backgroundColor: colors.softOrange, color: '#80513e' },
  badgeRevoked: { backgroundColor: colors.dangerSoft, color: colors.danger },
  feedbackBanner: {
    backgroundColor: colors.softBlue,
    borderRadius: 16,
    padding: 13,
    marginBottom: 16,
  },
  feedbackText: {
    fontFamily: fonts.bodyMedium,
    color: colors.primary,
    fontSize: 13,
    textAlign: 'center',
  },
  error: {
    fontFamily: fonts.bodyMedium,
    color: colors.danger,
    textAlign: 'center',
    fontSize: 15,
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: colors.primary,
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 14,
  },
  retryButtonText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.white,
    fontSize: 13,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorBannerText: {
    fontFamily: fonts.bodyMedium,
    color: colors.danger,
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  retryButtonBanner: {
    backgroundColor: colors.white,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 10,
  },
  retryButtonBannerText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.danger,
    fontSize: 12,
  },
  actionErrorBanner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 14,
    padding: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionErrorText: {
    fontFamily: fonts.body,
    color: colors.danger,
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  inlineRetryButton: {
    backgroundColor: colors.white,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 9,
  },
  inlineRetryText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.danger,
    fontSize: 11,
  },
  empty: { fontFamily: fonts.body, color: colors.muted, fontSize: 13 },
});

export default SuperAdminDashboardScreen;
