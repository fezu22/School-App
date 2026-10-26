import React from 'react';
import { Text } from 'react-native';
import { SectionCard, StatusBadge } from '../hiraDashboard';
import { formStyles } from '../hiraDashboard/AdminForm';
import type { Coverage } from '../../services/teacher/academicService';

export default function SyllabusCoverage({ coverage }: { coverage: Coverage }) {
  return (
    <>
      <SectionCard title="Syllabus Progress">
        <Text style={formStyles.copy}>
          Published version {coverage.version} • {coverage.completedTopics} /{' '}
          {coverage.totalTopics} topics completed (
          {coverage.completedPercentage}%)
        </Text>
        <Text style={formStyles.helper}>
          Completed percentage counts completed canonical topics only. Partial
          topics do not count as completed. Progress comes from recorded
          delivery evidence.
        </Text>
      </SectionCard>
      {coverage.units.map(unit => (
        <SectionCard key={unit.unitId} title={unit.title}>
          <Text style={formStyles.copy}>
            {unit.completedTopics} completed • {unit.partialTopics} partial •{' '}
            {unit.pendingTopics} pending
          </Text>
          {unit.topics.map(topic => (
            <React.Fragment key={topic.topicId}>
              <Text style={formStyles.label}>{topic.title}</Text>
              <StatusBadge
                status={topic.state === 'completed' ? 'paid' : 'pending'}
                label={
                  topic.state === 'completed'
                    ? 'Completed'
                    : topic.state === 'partial'
                    ? 'Partial'
                    : 'Pending'
                }
              />
            </React.Fragment>
          ))}
        </SectionCard>
      ))}
    </>
  );
}
