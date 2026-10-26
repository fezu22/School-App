import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.schoolmanagementsystem.session';
const USERNAME = 'school-session';

export async function saveSession(session) {
  const token = String(session?.token || '');
  const expiresAt = String(session?.expiresAt || '');
  const user = session?.user;
  if (!token || !expiresAt || !user?.id || !user?.role) {
    throw new Error('The school API returned an invalid session.');
  }
  await Keychain.setGenericPassword(
    USERNAME,
    JSON.stringify({ token, expiresAt, user }),
    {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

export async function loadSession() {
  const credentials = await Keychain.getGenericPassword({ service: SERVICE });
  if (!credentials) return null;
  try {
    const session = JSON.parse(credentials.password);
    if (
      !session?.token ||
      !session?.expiresAt ||
      !session?.user?.id ||
      !session?.user?.role
    ) {
      await clearStoredSession();
      return null;
    }
    return session;
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function clearStoredSession() {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
