import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Button,
  Card,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import {
  ApprovalRequest,
  principalService,
} from '../../services/principal/principalService';
import { colors, typography } from '../../theme/hiraDashboard';
import { lessonReviewService } from '../../services/teacher/academicService';

interface PrincipalApprovalsScreenProps {
  onReview: (request: ApprovalRequest) => void;
  onOpenResults?: () => void;
}

const entityLabel = (type: string) =>
  type === 'attendance_correction'
    ? 'Attendance correction'
    : type === 'student_leave'
    ? 'Student leave'
    : type;
const approvalTitle = (request: ApprovalRequest): string => {
  const typeNames: Record<string, string> = {
    lesson_plan: 'Lesson plan',
    academic_result: 'Marks moderation',
    leave: 'Leave request',
    attendance_correction: 'Attendance correction',
    refund: 'Refund request',
    discount: 'Fee concession',
    result: 'Results',
    paper: 'Examination paper',
    purchase: 'Purchase request',
    payroll: 'Payroll request',
    certificate: 'Certificate request',
  };
  const category = typeNames[request.approvalType] ?? request.approvalType;
  const requester = request.requesterId;
  const subject =
    typeof requester === 'string' ? request.entityType : requester.fullName;
  return `${category} · ${subject}`;
};

const formatDate = (rawDate: string): string => {
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime())
    ? rawDate
    : date.toLocaleDateString('en-PK', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
};

export default function PrincipalApprovalsScreen({
  onReview,
  onOpenResults,
}: PrincipalApprovalsScreenProps) {
  const { accessToken } = useAuth();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [lessonHistory, setLessonHistory] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!accessToken) {
      setError('Your session is unavailable. Please sign in again.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = lessonHistory ? await lessonReviewService.history(accessToken)
        : (await principalService.getPendingApprovals(accessToken)).data.requests;
      if (current === generation.current) setRequests(rows);
    } catch (requestError: unknown) {
      if (current === generation.current)
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load approvals.',
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken, lessonHistory]);

  const visibleRequests = requests.filter(request => {
    const requester = request.requesterId;
    const requesterText =
      typeof requester === 'string'
        ? requester
        : `${requester.fullName} ${requester.email}`;
    const searchable =
      `${requesterText} ${request.entityType} ${request.approvalType} ${request.reason}`.toLocaleLowerCase();
    return (
      (typeFilter === 'all' || request.approvalType === typeFilter) &&
      searchable.includes(query.trim().toLocaleLowerCase())
    );
  });
  const approvalTypes = [
    'all',
    ...new Set([
      ...(typeFilter === 'all' ? [] : [typeFilter]),
      ...requests.map(request => request.approvalType),
    ]),
  ];

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
      return () => {
        ++generation.current;
      };
    }, [load]),
  );

  return (
    <DashboardShell
      safeArea={false}
      refreshing={loading}
      onRefresh={() => load()}
    >
      <ScreenHeading
        title={lessonHistory ? 'Lesson History & Coverage' : 'A thoughtful second look.'}
        subtitle={lessonHistory ? 'Read lesson decisions and actual delivery evidence in your branch.' : 'Review the requests that keep your school moving.'}
      />
      {onOpenResults ? <SectionCard title="Results"><Text style={styles.muted}>Reopen approved results awaiting publication, review pending marks or view published results.</Text><Button title="Results / Awaiting Publication" variant="secondary" onPress={onOpenResults} /></SectionCard> : null}
      <SectionCard title={lessonHistory ? 'Reviewed and submitted lessons' : 'Approval inbox'}>
        <Button title={lessonHistory ? 'Pending Approval Inbox' : 'Lesson History & Coverage'} variant="secondary" onPress={() => { setLessonHistory(v => !v); setTypeFilter('all'); setSelectedRequestId(null); setRequests([]); }} />
        {selectedRequestId ? (
          <Text style={styles.muted}>
            Selected request:{' '}
            {(() => {
              const selected = requests.find(
                item => item._id === selectedRequestId,
              );
              return selected &&
                ['attendance_correction', 'student_leave', 'lesson_plan'].includes(
                  selected.entityType,
                )
                ? approvalTitle(selected)
                : selectedRequestId;
            })()}
            {!loading &&
            !error &&
            !requests.some(request => request._id === selectedRequestId)
              ? ' · No longer in the pending inbox.'
              : ''}
          </Text>
        ) : null}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search requester, type, subject or reason"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Search approval requests"
          style={styles.searchInput}
        />
        <View style={styles.filters}>
          {approvalTypes.map(type => (
            <Button
              key={type}
              title={type === 'all' ? 'All types' : type.replaceAll('_', ' ')}
              variant={typeFilter === type ? 'primary' : 'secondary'}
              onPress={() => setTypeFilter(type)}
              style={styles.filterButton}
            />
          ))}
        </View>
        {loading && requests.length === 0 ? (
          <View>
            {[0, 1, 2].map(index => (
              <View key={index} style={styles.skeletonRow}>
                <View style={styles.skeletonIcon} />
                <View style={styles.skeletonCopy}>
                  <View style={styles.skeletonTitle} />
                  <View style={styles.skeletonSubtitle} />
                </View>
                <View style={styles.skeletonChip} />
              </View>
            ))}
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.body}>{error}</Text>
            <Button title="Retry" variant="secondary" onPress={() => load()} />
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.title}>Nothing waiting for you</Text>
            <Text style={styles.muted}>New requests will appear here.</Text>
          </View>
        ) : visibleRequests.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.muted}>
              No requests match this search or filter.
            </Text>
          </View>
        ) : (
          visibleRequests.map((request, index) => (
            <View
              key={request._id}
              style={[
                styles.row,
                request._id === selectedRequestId && styles.selectedRow,
                index < visibleRequests.length - 1 && styles.divider,
              ]}
            >
              <View style={styles.iconTile}>
                <Text style={styles.icon}>✓</Text>
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.title}>{approvalTitle(request)}</Text>
                <Text style={styles.muted} numberOfLines={2}>
                  {[
                    formatDate(request.createdAt),
                    entityLabel(request.entityType),
                    request.amount !== undefined
                      ? `Amount ${request.amount.toLocaleString('en-PK')}`
                      : undefined,
                    request.reason,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <Text style={styles.pending}>{request.status.replaceAll('_', ' ')}</Text>
                <Button
                  title={lessonHistory && request.status !== 'pending' ? 'View lesson' : 'Review'}
                  variant="secondary"
                  onPress={() => {
                    setSelectedRequestId(request._id);
                    onReview(request);
                  }}
                  style={styles.reviewButton}
                />
              </View>
            </View>
          ))
        )}
      </SectionCard>
      <Card style={styles.policyNote}>
        <Text style={styles.policyText}>
          Each decision records its reviewer, time and reason. High-impact
          actions follow the school’s configured approval limits.
        </Text>
      </Card>
    </DashboardShell>
  );
}

const styles = StyleSheet.create({
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  skeletonIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#f0eee9',
  },
  skeletonCopy: { flex: 1, gap: 7 },
  skeletonTitle: {
    height: 12,
    width: '78%',
    borderRadius: 6,
    backgroundColor: '#f0eee9',
  },
  skeletonSubtitle: {
    height: 10,
    width: '92%',
    borderRadius: 5,
    backgroundColor: '#f0eee9',
  },
  skeletonChip: {
    height: 26,
    width: 56,
    borderRadius: 6,
    backgroundColor: '#f6ead3',
  },
  state: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  searchInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: colors.ink,
    ...typography.small,
    marginBottom: 10,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  filterButton: { minHeight: 34, paddingVertical: 5, paddingHorizontal: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  selectedRow: { backgroundColor: colors.soft },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.softBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { color: colors.primary, fontSize: 18 },
  rowCopy: { flex: 1, gap: 5 },
  rowActions: { alignItems: 'flex-end', gap: 7 },
  reviewButton: { minHeight: 36, paddingVertical: 6, paddingHorizontal: 12 },
  title: { ...typography.bodyStrong, color: colors.ink },
  muted: { ...typography.caption, color: colors.muted },
  body: { ...typography.body, color: colors.ink, textAlign: 'center' },
  pending: {
    ...typography.caption,
    color: colors.pending.text,
    backgroundColor: colors.pending.bg,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  policyNote: {
    backgroundColor: '#f2f8f2',
    borderStyle: 'dashed',
    borderColor: '#b4d0ba',
  },
  policyText: { ...typography.small, color: '#4d6b56' },
});
