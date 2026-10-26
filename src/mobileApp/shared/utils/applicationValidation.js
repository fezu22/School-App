export const APPLICATION_TITLE_LIMIT = 120;
export const APPLICATION_MESSAGE_LIMIT = 4000;

export function validateApplicationDraft(title, message) {
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  const normalizedMessage = typeof message === 'string' ? message.trim() : '';
  if (!normalizedTitle) return { error: 'Enter an application subject.' };
  if (normalizedTitle.length > APPLICATION_TITLE_LIMIT) {
    return { error: `Subject must be at most ${APPLICATION_TITLE_LIMIT} characters.` };
  }
  if (!normalizedMessage) return { error: 'Enter an application message.' };
  if (normalizedMessage.length > APPLICATION_MESSAGE_LIMIT) {
    return { error: `Message must be at most ${APPLICATION_MESSAGE_LIMIT.toLocaleString()} characters.` };
  }
  return { value: { title: normalizedTitle, message: normalizedMessage } };
}
