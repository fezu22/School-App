import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { BackHandler } from 'react-native';
import HiraHome from '../shared/home/HiraHome';
import MessagesInbox from '../shared/chat/MessagesInbox';
import MobileApp from '../app/MobileApp';
import ParentSchoolStory from '../roles/parent/ParentSchoolStory';
import ParentMultiChildPayment from '../roles/parent/ParentMultiChildPayment';
import ReferenceNotifications from '../shared/notifications/ReferenceNotifications';
import { parentApi } from '../roles/parent/parentService';
import { chatApi } from '../shared/services/chatService';

jest.mock('../roles/parent/parentService', () => ({
  parentApi: {
    getChildren: jest.fn(),
    getChild: jest.fn(),
    getAttendance: jest.fn(),
    getResults: jest.fn(),
    getHomework: jest.fn(),
    getFees: jest.fn(),
    getFeeCheckoutConfig: jest.fn(),
    getFeedback: jest.fn(),
    getProgress: jest.fn(),
    getNotifications: jest.fn(),
    markNotificationRead: jest.fn(),
    getNotification: jest.fn(),
  },
}));
jest.mock('../roles/student/studentService', () => ({
  studentApi: { getProfile: jest.fn() },
}));
jest.mock('../shared/services/chatService', () => ({
  chatApi: {
    getConversations: jest.fn().mockResolvedValue({ conversations: [] }),
    getMessages: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
    markRead: jest.fn().mockResolvedValue({ markedRead: 0 }),
    getTeachers: jest.fn().mockResolvedValue({ teachers: [] }),
    startConversation: jest.fn(),
    sendMessage: jest.fn(),
    uploadAttachment: jest.fn(),
  },
  createChatConnection: jest.fn(() => ({ close: jest.fn() })),
  createClientMessageId: jest.fn(() => 'test-client-message-id'),
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { images: 'image/*' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: () => false,
}));

// Keep the navigation-shell test focused on its own routes. Importing the real
// dashboards pulls in native-only modules (for example the document picker).
jest.mock('../app/RoleDashboard', () => () => null);
jest.mock('../features/FeaturePage', () => () => null);
jest.mock('../TeacherApplicationsPage', () => () => null);
jest.mock('../shared/notifications/NotificationDrawer', () => () => null);

const flush = () => new Promise(resolve => setImmediate(resolve));
const visibleText = tree =>
  tree.root
    .findAll(node => node.children.some(child => typeof child === 'string'))
    .flatMap(node => node.children.filter(child => typeof child === 'string'))
    .join(' ');

describe('Parent UI replacement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    parentApi.getChildren.mockResolvedValue([]);
    parentApi.getChild.mockResolvedValue(null);
    parentApi.getAttendance.mockResolvedValue([]);
    parentApi.getResults.mockResolvedValue([]);
    parentApi.getHomework.mockResolvedValue([]);
    parentApi.getFees.mockResolvedValue([]);
    parentApi.getFeeCheckoutConfig.mockResolvedValue({
      enabled: false,
      methods: [],
    });
    parentApi.getFeedback.mockResolvedValue({});
    parentApi.getProgress.mockResolvedValue([]);
    parentApi.getNotifications.mockResolvedValue({
      notifications: [],
      unreadCount: 0,
    });
  });

  test('Parent Home quick links open the requested sections', async () => {
    const navigate = jest.fn();
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <HiraHome
          role="Parent"
          previewOnly
          user={{ fullName: 'Demo Parent' }}
          reducedMotion
          onNavigate={navigate}
        />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain('Stay connected');
    expect(visibleText(tree)).toContain('A date for your diary');
    act(() =>
      tree.root.findByProps({ accessibilityLabel: 'Inbox' }).props.onPress(),
    );
    expect(navigate).toHaveBeenCalledWith('Inbox');
    act(() => tree.unmount());
  }, 15000);

  test('Parent payment screen reads real invoices but keeps batch checkout disabled without an adapter', async () => {
    parentApi.getChildren.mockResolvedValue([
      { id: 'child-1', fullName: 'Mina Khan', grade: 'Grade 4', section: 'B' },
    ]);
    parentApi.getFees.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'INV-1',
        period: 'October 2026',
        amount: 1500,
        paidAmount: 250,
        pendingAmount: 0,
        balanceDue: 1250,
        availableBalance: 1250,
        currency: 'PKR',
      },
    ]);

    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ParentMultiChildPayment previewOnly={false} />,
      );
      await flush();
    });
    expect(parentApi.getFees).toHaveBeenCalledWith('child-1');
    expect(visibleText(tree)).toContain('Mina Khan');
    expect(visibleText(tree)).toContain('INV-1');

    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Select Mina Khan INV-1' })
        .props.onPress(),
    );
    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Pay selected fees' })
        .props.onPress(),
    );

    expect(visibleText(tree)).toContain(
      'Multi-child online payment is not connected yet. Your fees have not been paid.',
    );
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Continue to pay PKR 1,250' })
        .props.disabled,
    ).toBe(true);
    act(() => tree.unmount());
  });

  test('Developer Preview labels the sample receipt and never claims server verification', async () => {
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ParentMultiChildPayment previewOnly previewScreen="fees" />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain(
      'DESIGN PREVIEW · SAMPLE DATA · NO REAL PAYMENT',
    );
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: 'Preview receipt layout' })
        .props.onPress();
      await flush();
    });
    expect(visibleText(tree)).toContain('Receipt design preview');
    expect(visibleText(tree)).toContain(
      'Sample receipt layout only. No payment was processed.',
    );
    expect(visibleText(tree)).toContain('Design sample');
    expect(visibleText(tree)).not.toContain(
      'Your payment has been verified by the server.',
    );
    act(() => tree.unmount());
  });

  test('Progress switches child and clears the previous child summary', async () => {
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ParentSchoolStory previewOnly onNavigate={() => {}} />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain('Ahmed Khan’s school story');
    expect(visibleText(tree)).toContain('5,250');

    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Switch child' })
        .props.onPress(),
    );
    const childOption = tree.root.findAll(node =>
      String(node.props.accessibilityLabel || '').startsWith('Sara Khan.'),
    )[0];
    expect(childOption?.props.onPress).toEqual(expect.any(Function));
    act(() => childOption.props.onPress());

    expect(visibleText(tree)).toContain('Sara Khan’s school story');
    expect(visibleText(tree)).not.toContain('5,250');
    act(() => tree.unmount());
  });

  test('Inbox preview stays empty rather than inventing conversations or messages', async () => {
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <MessagesInbox role="Parent" previewOnly onNavigate={() => {}} />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain('School inbox');
    expect(visibleText(tree)).toContain('No sample conversations');
    expect(visibleText(tree)).toContain(
      'Preview does not create or send messages.',
    );
    expect(visibleText(tree)).not.toContain('Transport office');
    expect(visibleText(tree)).not.toContain('School office');
    expect(visibleText(tree)).not.toContain('Miss Ayesha');
    expect(tree.root.findAllByType('TextInput')).toHaveLength(1);
    act(() => tree.unmount());

    await act(async () => {
      tree = ReactTestRenderer.create(
        <MessagesInbox role="Parent" onNavigate={() => {}} />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain('No conversations yet');
    expect(visibleText(tree)).toContain('New conversation');
    act(() => tree.unmount());
  });

  test('chat image upload reports progress and only adds the message after server confirmation', async () => {
    let failUpload;
    let attempt = 0;
    chatApi.getConversations.mockResolvedValue({
      conversations: [
        {
          id: 'conversation-1',
          teacherName: 'Teacher A',
          studentName: 'Student 002',
          unreadCount: 0,
        },
      ],
    });
    chatApi.getMessages.mockResolvedValue({ messages: [], hasMore: false });
    chatApi.uploadAttachment.mockImplementation(({ onProgress }) => {
      attempt += 1;
      onProgress(attempt === 1 ? 25 : 75, 100);
      return attempt === 1
        ? new Promise((_resolve, reject) => {
            failUpload = reject;
          })
        : Promise.resolve({
            message: {
              id: 'server-message-1',
              body: 'Here is the photo',
              attachments: [],
              createdAt: new Date().toISOString(),
            },
          });
    });
    const picker = require('@react-native-documents/picker');
    picker.pick.mockResolvedValue([
      {
        uri: 'content://school/photo.png',
        name: 'photo.png',
        type: 'image/png',
        size: 1024,
        hasRequestedType: true,
      },
    ]);

    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <MessagesInbox
          role="Parent"
          userId="parent-user"
          onNavigate={() => {}}
        />,
      );
      await flush();
    });
    const conversation = tree.root.findAll(node =>
      String(node.props.accessibilityLabel || '').startsWith('Teacher A.'),
    )[0];
    await act(async () => {
      conversation.props.onPress();
      await flush();
    });

    const input = tree.root
      .findAllByType('TextInput')
      .find(node => node.props.accessibilityLabel === 'Write a message');
    act(() => input.props.onChangeText('Here is the photo'));
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: 'Attach image' })
        .props.onPress();
      await flush();
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: 'Send message' })
        .props.onPress();
      await flush();
    });
    expect(chatApi.uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        body: 'Here is the photo',
        file: expect.objectContaining({ name: 'photo.png' }),
        onProgress: expect.any(Function),
      }),
    );
    expect(visibleText(tree)).toMatch(/Uploading image\s*·\s*25\s*%/);
    expect(visibleText(tree)).not.toContain('Here is the photo');

    await act(async () => {
      failUpload(new Error('Connection interrupted'));
      await flush();
    });
    expect(visibleText(tree)).toContain('Retry image upload');
    expect(visibleText(tree)).not.toContain('Here is the photo');
    const firstMessageId =
      chatApi.uploadAttachment.mock.calls[0][0].clientMessageId;
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: 'Retry image upload' })
        .props.onPress();
      await flush();
    });
    expect(chatApi.uploadAttachment).toHaveBeenCalledTimes(2);
    expect(chatApi.uploadAttachment.mock.calls[1][0].clientMessageId).toBe(
      firstMessageId,
    );
    expect(visibleText(tree)).toContain('Here is the photo');
    act(() => tree.unmount());
  });

  test('Notifications are a separate page and open the exact shared record', async () => {
    const notice = {
      id: 'notice-1',
      title: 'Teacher DLP received',
      body: 'Class 6-A · Fractions',
    };
    parentApi.getNotifications.mockResolvedValue({
      notifications: [notice],
      unreadCount: 1,
    });
    parentApi.markNotificationRead.mockResolvedValue({ read: true });
    parentApi.getNotification.mockResolvedValue({
      notification: notice,
      dlpVersion: {
        id: 'dlp-version-1',
        title: 'Fractions in daily life',
        className: '6-A',
        version: 3,
        content: 'Practice questions 1–4.',
      },
    });
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<ReferenceNotifications role="Parent" />);
      await flush();
    });
    expect(visibleText(tree)).toContain('Notifications');
    expect(visibleText(tree)).toContain('Teacher DLP received');
    await act(async () => {
      tree.root
        .findByProps({
          accessibilityLabel: 'Open notification: Teacher DLP received',
        })
        .props.onPress();
      await flush();
    });
    expect(parentApi.markNotificationRead).toHaveBeenCalledWith('notice-1');
    expect(parentApi.getNotification).toHaveBeenCalledWith('notice-1');
    expect(visibleText(tree)).toContain('Fractions in daily life');
    expect(visibleText(tree)).toContain('Practice questions 1–4.');
    act(() => tree.unmount());
  });

  test('Live Inbox opens persisted history and confirms a sent message through the API', async () => {
    const conversation = {
      id: 'conversation-1',
      studentId: 'student-1',
      studentName: 'Ahmed Khan',
      teacherId: 'teacher-1',
      teacherName: 'Miss Ayesha',
      unreadCount: 1,
    };
    chatApi.getConversations.mockResolvedValue({
      conversations: [conversation],
    });
    chatApi.getMessages.mockResolvedValue({
      messages: [
        {
          id: 'message-1',
          conversationId: conversation.id,
          senderUserId: 'teacher-1',
          senderRole: 'teacher',
          body: 'Welcome',
          createdAt: '2026-10-01T10:00:00Z',
          readByOther: false,
        },
      ],
      hasMore: false,
    });
    chatApi.sendMessage.mockImplementation(async (conversationId, body) => ({
      message: {
        id: 'message-2',
        conversationId,
        senderUserId: 'parent-1',
        senderRole: 'parent',
        body,
        createdAt: '2026-10-01T10:01:00Z',
        readByOther: false,
      },
    }));
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <MessagesInbox role="Parent" userId="parent-1" onNavigate={() => {}} />,
      );
      await flush();
    });
    await act(async () => {
      await tree.root
        .findAll(node =>
          String(node.props.accessibilityLabel || '').startsWith('Miss Ayesha'),
        )[0]
        .props.onPress();
      await flush();
    });
    expect(visibleText(tree)).toContain('Welcome');
    expect(chatApi.markRead).toHaveBeenCalledWith(conversation.id);
    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Write a message' })
        .props.onChangeText('Thanks'),
    );
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: 'Send message' })
        .props.onPress();
      await flush();
    });
    expect(chatApi.sendMessage).toHaveBeenCalledWith(
      conversation.id,
      'Thanks',
      expect.any(String),
    );
    expect(visibleText(tree)).toContain('Thanks');
    act(() => tree.unmount());
  });

  test('left drawer opens with the Parent navigation', async () => {
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<MobileApp developmentPreview />);
      await flush();
    });
    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Open left navigation' })
        .props.onPress(),
    );
    expect(visibleText(tree)).toContain('YOUR SCHOOL WORKSPACE');
    for (const section of [
      'Transport & Safety',
      'Learning',
      'Reports',
      'Calendar & Meetings',
      'Fees & Payments',
      'Notifications',
      'Inbox',
    ]) {
      expect(
        tree.root.findAllByProps({ accessibilityLabel: section }).length,
      ).toBeGreaterThan(0);
    }
    expect(
      tree.root.findAllByProps({
        accessibilityLabel: 'Student Progress Tracking',
      }),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });

  test('drawer navigation opens Reports and then the selected report', async () => {
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<MobileApp developmentPreview />);
      await flush();
    });
    act(() => tree.root.findByProps({accessibilityLabel: 'Open left navigation'}).props.onPress());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    act(() => tree.root.findByProps({accessibilityLabel: 'Reports'}).props.onPress());
    expect(visibleText(tree)).toContain('Reports');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    act(() => tree.root.findByProps({accessibilityLabel: 'Open Academic Report'}).props.onPress());
    expect(tree.root.findByProps({accessibilityLabel: 'Back to Reports'})).toBeDefined();
    act(() => tree.unmount());
  });

  test('back after opening Parent Progress returns to the dashboard', async () => {
    let back;
    const subscription = jest.spyOn(BackHandler, 'addEventListener')
      .mockImplementation((event, listener) => {
        if (event === 'hardwareBackPress') back = listener;
        return {remove: jest.fn()};
      });
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<MobileApp developmentPreview />);
      await flush();
    });
    act(() => tree.root.findByProps({accessibilityLabel: 'Progress'}).props.onPress());
    expect(tree.root.findByProps({accessibilityLabel: 'Back to Reports'})).toBeDefined();
    act(() => expect(back()).toBe(true));
    expect(tree.root.findByType(HiraHome)).toBeDefined();
    act(() => tree.unmount());
    subscription.mockRestore();
  });

  test('hardware back from a child report returns to their story then My children', async () => {
    let back;
    const subscription = jest.spyOn(BackHandler, 'addEventListener')
      .mockImplementation((event, listener) => {
        if (event === 'hardwareBackPress') back = listener;
        return {remove: jest.fn()};
      });
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<MobileApp developmentPreview />);
      await flush();
    });
    await act(async () => {
      tree.root.findByType(HiraHome).props.onNavigate('My children');
      await flush();
    });
    const ParentChildrenPage = require('../roles/parent/ParentChildrenPage').default;
    await act(async () => {
      tree.root.findByType(ParentChildrenPage).props.onNavigate('Student Progress Tracking', '002');
      await flush();
    });
    expect(tree.root.findAllByType(ParentSchoolStory)).toHaveLength(1);
    act(() => tree.root.findByType(ParentSchoolStory).props.onNavigate('Academic Report', '002'));
    act(() => tree.root.findByProps({accessibilityLabel: 'Back to Reports'}).props.onPress());
    await act(async () => { await flush(); });
    expect(tree.root.findAllByType(ParentSchoolStory)).toHaveLength(1);
    await act(async () => { expect(back()).toBe(true); await flush(); });
    expect(tree.root.findAllByType(ParentChildrenPage)).toHaveLength(1);
    expect(tree.root.findAllByProps({accessibilityLabel: 'Open Academic Report'})).toHaveLength(0);
    act(() => tree.unmount());
    subscription.mockRestore();
  });

  test('section cards open subpages and hardware back returns to the section then Home', async () => {
    let back;
    const backSubscription = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((event, listener) => {
        if (event === 'hardwareBackPress') back = listener;
        return { remove: jest.fn() };
      });
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<MobileApp developmentPreview />);
      await flush();
    });
    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Open left navigation' })
        .props.onPress(),
    );
    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Fees & Payments' })
        .props.onPress(),
    );
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 240));
    });
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Open Student Fees' }),
    ).toBeDefined();
    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Open Receipt Details' })
        .props.onPress(),
    );
    let handled;
    act(() => {
      handled = back();
    });
    expect(handled).toBe(true);
    expect(
      tree.root.findByProps({ accessibilityLabel: 'Open Student Fees' }),
    ).toBeDefined();
    act(() => {
      handled = back();
    });
    expect(handled).toBe(true);
    expect(visibleText(tree)).toContain('Overview');
    act(() => tree.unmount());
    backSubscription.mockRestore();
  });
});
