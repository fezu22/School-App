import React from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  Card,
  HeroBanner,
  ListRow,
  ScreenHeading,
  SectionCard,
  StatCard,
  StatGrid,
  Button,
} from '../../components/hiraDashboard';
import {
  DashboardShell,
  DashboardStateCard,
} from '../../components/hiraDashboard/DashboardShell';
import { usePrincipalDashboardData } from '../../hooks/usePrincipalDashboardData';
import { colors, typography } from '../../theme/hiraDashboard';
import {TeacherAssignmentEntry} from '../admin/TeacherAssignmentEntry';

interface PrincipalDashboardScreenProps {
  onOpenApprovals: () => void;
  onOpenInbox: () => void;
  onOpenTasks: () => void;
  onOpenSafety: () => void;
  onAssignTeacher?: () => void;
}

export default function PrincipalDashboardScreen({
  onOpenApprovals,
  onOpenInbox,
  onOpenTasks,
  onOpenSafety,
  onAssignTeacher,
}: PrincipalDashboardScreenProps) {
  const { data, loading, error, reload } = usePrincipalDashboardData();
  const today = new Date().toLocaleDateString('en-PK', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <DashboardShell safeArea={false}>
      <ScreenHeading title="Principal overview" subtitle={data?.branch.name} />
      <DashboardStateCard loading={loading} error={error} onRetry={reload} />
      <SectionCard title="Safety / School Overview">
        <Text style={styles.note}>
          {data
            ? `${data.safetyAlerts.total} active alerts · ${data.safetyAlerts.critical} critical`
            : 'Review operational alerts in your branch.'}
        </Text>
        <Button
          title="Open Safety Overview"
          variant="secondary"
          onPress={onOpenSafety}
        />
      </SectionCard>
      {onAssignTeacher ? <TeacherAssignmentEntry onAssign={onAssignTeacher} /> : null}
      <SectionCard title="Tasks">
        <Text style={styles.note}>
          {data?.tasks
            ? `${data.tasks.length} branch tasks · ${
                data.tasks.filter(
                  task =>
                    task.status === 'pending' || task.status === 'in_progress',
                ).length
              } active`
            : 'Assign and track tasks in your branch.'}
        </Text>
        <Button title="Open Tasks" variant="secondary" onPress={onOpenTasks} />
      </SectionCard>
      {data ? (
        <>
          <HeroBanner
            roleLabel="SCHOOL OPERATIONS"
            dateLabel={today}
            bigValue={data.students.total.toLocaleString('en-PK')}
            bigValueCaption="students in this branch"
            title="Your school at a glance"
            subtitle="Enrollment, attendance and approval activity"
          />
          <StatGrid>
            <StatCard
              accentIndex={0}
              icon="◇"
              label="Fee outstanding"
              value={data.feeSummary.outstandingAmount.toLocaleString('en-PK')}
              foot={`${data.feeSummary.overdueInvoices} overdue invoices`}
            />
            <StatCard
              accentIndex={1}
              icon="✓"
              label="Attendance"
              value={`${data.attendance.attendancePercentage}%`}
              foot="Present and late today"
            />
            <StatCard
              accentIndex={2}
              icon="▤"
              label="Safety alerts"
              value={data.safetyAlerts.total}
              foot={`${data.safetyAlerts.critical} critical · ${data.safetyAlerts.open} open`}
            />
            <StatCard
              accentIndex={3}
              icon="✉"
              label="School notices"
              value={data.notices.length}
              foot="Published notices for this branch"
            />
          </StatGrid>
          <SectionCard title="Branch snapshot">
            <Card style={styles.unavailableCard}>
              <Text style={styles.note}>
                {data.students.active} active of {data.students.total} students
                · {data.attendance.totalMarked} attendance records today ·{' '}
                {data.feeSummary.paidAmount.toLocaleString('en-PK')} collected
              </Text>
            </Card>
          </SectionCard>
          <SectionCard title="Review workspace">
            <ListRow
              icon="✓"
              title="School approvals"
              subtitle={`${data.pendingApprovals.total} pending requests`}
              tag="Review"
              last
              onPress={onOpenApprovals}
            />
            <ListRow
              icon="✉"
              title="School notices"
              subtitle={`${data.notices.length} published notices`}
              tag="Open"
              last
              onPress={onOpenInbox}
            />
          </SectionCard>
        </>
      ) : null}
    </DashboardShell>
  );
}

const styles = StyleSheet.create({
  unavailableCard: {
    padding: 12,
    marginBottom: 0,
    borderBottomWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  note: { ...typography.small, color: colors.muted },
});
