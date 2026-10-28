import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import UltraAdminScreen from '../UltraAdminScreen';
import TeachersDlpPage from '../TeachersDlpPage';
import RecordedLessonsPage from '../RecordedLessonsPage';
import TeacherApplicationsPage from '../TeacherApplicationsPage';
import { authRequest } from '../shared/services/authRequest';

jest.mock('../shared/services/authRequest', () => ({
  authRequest: jest.fn(),
}));

const flush = () => new Promise(resolve => setImmediate(resolve));
const visibleText = tree =>
  tree.root
    .findAll(node => node.children.some(child => typeof child === 'string'))
    .flatMap(node => node.children.filter(child => typeof child === 'string'))
    .join(' ');

describe('Merged modules frontend verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('UltraAdminScreen loads overview, schools, and audit logs and provisions a school', async () => {
    authRequest.mockImplementation((path, options) => {
      if (path === '/ultra-admin/overview') {
        return Promise.resolve({
          data: {
            metrics: {
              totalSchools: 1,
              activeSchools: 1,
              suspendedSchools: 0,
              recordedOnlySubscriptions: 1,
            },
          },
        });
      }
      if (path === '/ultra-admin/schools' && (!options || options.method !== 'POST')) {
        return Promise.resolve({
          data: [
            {
              id: 'school-1',
              name: 'Greenwood Main',
              code: 'GWM',
              status: 'active',
              plan: 'growth',
              subscriptionStatus: 'active_recorded',
              subscriptionVerification: 'recorded_only',
              usage: { branches: 1, staff: 12, students: 240 },
              usageLimits: { maxBranches: 5, maxStaff: 200, maxStudents: 2000 },
            },
          ],
        });
      }
      if (path === '/ultra-admin/audit-logs') {
        return Promise.resolve({
          data: [
            {
              id: 'log-1',
              action: 'school.provisioned',
              actorUserId: 'ultra-1',
              targetId: 'school-1',
            },
          ],
        });
      }
      return Promise.resolve({ data: {} });
    });

    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<UltraAdminScreen page="Home" previewOnly={false} />);
      await flush();
    });

    const text = visibleText(tree);
    expect(text).toContain('Platform Governance');
    expect(text).toContain('Greenwood Main');
    expect(text).toContain('recorded_only');
    expect(text).toContain('school.provisioned');
    act(() => tree.unmount());
  });

  test('TeachersDlpPage loads staff DLP directory and triggers separate Principal and Parent sharing actions', async () => {
    authRequest.mockImplementation(path => {
      if (path === '/dlp') {
        return Promise.resolve({
          data: [
            {
              id: 'dlp-101',
              title: 'Quadratic Equations & Graphs',
              subject: 'Mathematics',
              classId: 'Grade 9',
              section: 'A',
              versionNumber: 1,
              workCompletionStatus: 'completed',
              workCompletionDetails: 'Completed exercises 1-8.',
              internalStaffNotes: 'Internal staff note for Principal',
              principalReviewStatus: 'not_sent',
              parentShareStatus: 'not_shared',
            },
          ],
        });
      }
      return Promise.resolve({ data: {} });
    });

    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<TeachersDlpPage role="Teacher" previewOnly={false} />);
      await flush();
    });

    expect(visibleText(tree)).toContain('Quadratic Equations & Graphs');
    await act(async () => {
      const sendPrincipalBtn = tree.root
        .findAllByProps({ accessibilityRole: 'button' })
        .find(b => visibleText({ root: b }).includes('Send to Principal'));
      sendPrincipalBtn.props.onPress();
      await flush();
    });
    expect(authRequest).toHaveBeenCalledWith(
      '/dlp/dlp-101/send-principal',
      expect.objectContaining({ method: 'POST' }),
    );

    await act(async () => {
      const sendParentsBtn = tree.root
        .findAllByProps({ accessibilityRole: 'button' })
        .find(b => visibleText({ root: b }).includes('Send to Parents'));
      sendParentsBtn.props.onPress();
      await flush();
    });
    expect(authRequest).toHaveBeenCalledWith(
      '/dlp/dlp-101/send-parents',
      expect.objectContaining({ method: 'POST' }),
    );
    act(() => tree.unmount());
  });

  test('RecordedLessonsPage loads drafts and enforces review before publication', async () => {
    authRequest.mockImplementation(path => {
      if (path === '/recorded-lessons') {
        return Promise.resolve({
          data: [
            {
              id: 'lesson-1',
              title: 'Cellular Respiration & ATP',
              subject: 'Biology',
              classId: 'class-9',
              section: 'A',
              sourceVersion: 1,
              jobStatus: 'ai_draft_ready',
              teacherReviewed: false,
              published: false,
              aiDraft: {
                summary: 'AI Draft Summary',
                revisionNotes: 'ATP notes',
                quizQuestions: [],
              },
            },
          ],
        });
      }
      return Promise.resolve({ data: {} });
    });

    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<RecordedLessonsPage role="Teacher" previewOnly={false} />);
      await flush();
    });

    expect(visibleText(tree)).toContain('Cellular Respiration & ATP');
    await act(async () => {
      const approveBtn = tree.root
        .findAllByProps({ accessibilityRole: 'button' })
        .find(b => visibleText({ root: b }).includes('Approve Review'));
      approveBtn.props.onPress();
      await flush();
    });
    expect(authRequest).toHaveBeenCalledWith(
      '/recorded-lessons/lesson-1/review',
      expect.objectContaining({ method: 'POST' }),
    );
    act(() => tree.unmount());
  });

  test('TeacherApplicationsPage routes Teacher applications to Principal', async () => {
    authRequest.mockImplementation((path, options) => {
      if (path === '/applications') return Promise.resolve([]);
      if (path === '/applications/principal' && !options) return Promise.resolve([]);
      if (path === '/applications/principal' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'prin-app-1',
          title: 'Medical Leave Request',
          message: 'Requesting two days medical leave',
          status: 'submitted',
        });
      }
      return Promise.resolve([]);
    });

    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<TeacherApplicationsPage />);
      await flush();
    });

    act(() => {
      tree.root
        .findByProps({ accessibilityLabel: 'Principal application title' })
        .props.onChangeText('Medical Leave Request');
      tree.root
        .findByProps({ accessibilityLabel: 'Principal application message' })
        .props.onChangeText('Requesting two days medical leave');
    });

    await act(async () => {
      const sendBtn = tree.root
        .findAllByProps({ accessibilityRole: 'button' })
        .find(b => visibleText({ root: b }).includes('Send to Principal'));
      sendBtn.props.onPress();
      await flush();
    });

    expect(authRequest).toHaveBeenCalledWith(
      '/applications/principal',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(visibleText(tree)).toContain('Medical Leave Request');
    act(() => tree.unmount());
  });
});
