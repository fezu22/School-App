import { Platform, Linking } from 'react-native';
import type { PermissionStatus, Permission } from 'react-native-permissions';
export interface MediaPermissions {
  camera: PermissionStatus;
  microphone: PermissionStatus;
}
const keys = (
  PERMISSIONS: typeof import('react-native-permissions')['PERMISSIONS'],
) =>
  Platform.OS === 'ios'
    ? { camera: PERMISSIONS.IOS.CAMERA, microphone: PERMISSIONS.IOS.MICROPHONE }
    : {
        camera: PERMISSIONS.ANDROID.CAMERA,
        microphone: PERMISSIONS.ANDROID.RECORD_AUDIO,
      };
export const mediaPermissions = {
  async check(): Promise<MediaPermissions> {
    const { check, PERMISSIONS } =
      require('react-native-permissions') as typeof import('react-native-permissions');
    const k = keys(PERMISSIONS);
    const [camera, microphone] = await Promise.all([
      check(k.camera),
      check(k.microphone),
    ]);
    return { camera, microphone };
  },
  async request(): Promise<MediaPermissions> {
    const { check, request, PERMISSIONS, RESULTS } =
      require('react-native-permissions') as typeof import('react-native-permissions');
    const k = keys(PERMISSIONS);
    const obtain = async (permission: Permission) => {
      const status = await check(permission);
      return status === RESULTS.DENIED ? request(permission) : status;
    };
    // Sequential prompts avoid overlapping OS permission dialogs.
    const camera = await obtain(k.camera),
      microphone = await obtain(k.microphone);
    return { camera, microphone };
  },
  settings: () => Linking.openSettings(),
};
export const canCapture = (state: MediaPermissions) =>
  state.camera === 'granted' && state.microphone === 'granted';
export const permissionMessage = (name: string, status: PermissionStatus) =>
  `${name}: ${
    status === 'granted'
      ? 'allowed'
      : status === 'blocked'
      ? 'blocked — enable in Settings'
      : status === 'unavailable'
      ? 'unavailable on this device'
      : 'permission required'
  }`;
