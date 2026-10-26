import {
  APPLICATION_MESSAGE_LIMIT,
  APPLICATION_TITLE_LIMIT,
  validateApplicationDraft,
} from '../shared/utils/applicationValidation';

test('valid application drafts are trimmed before submission', () => {
  expect(validateApplicationDraft(' Leave ', ' Medical appointment ')).toEqual({
    value: { title: 'Leave', message: 'Medical appointment' },
  });
});

test('application drafts enforce required fields and server-aligned limits', () => {
  expect(validateApplicationDraft('', 'Message').error).toMatch(/subject/i);
  expect(validateApplicationDraft('Subject', '').error).toMatch(/message/i);
  expect(
    validateApplicationDraft('x'.repeat(APPLICATION_TITLE_LIMIT + 1), 'Message').error,
  ).toMatch(/120/);
  expect(
    validateApplicationDraft('Subject', 'x'.repeat(APPLICATION_MESSAGE_LIMIT + 1)).error,
  ).toMatch(/4,000/);
});
