import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

const DEFAULT_API_PORT = 5000;

function cleanRoot(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function configuredRoot() {
  return cleanRoot(
    globalThis.__SCHOOL_API_ROOT__ ||
      NativeModules?.SchoolManagementConfig?.apiRoot,
  );
}

function configuredPort() {
  const value = Number(
    globalThis.__SCHOOL_API_PORT__ ||
      NativeModules?.SchoolManagementConfig?.apiPort,
  );
  return Number.isInteger(value) && value > 0 && value <= 65535
    ? value
    : DEFAULT_API_PORT;
}

function metroHost() {
  // Bridgeless builds expose SourceCode through TurboModules.
  const sourceCode =
    TurboModuleRegistry.get('SourceCode') || NativeModules?.SourceCode;
  const scriptUrl =
    sourceCode?.getConstants?.().scriptURL || sourceCode?.scriptURL || '';
  const match = String(scriptUrl).match(/^[a-z]+:\/\/\[?([^\]/:]+|[^\]]+)\]?:\d+/i);
  return match?.[1] || '';
}

export function resolveApiRoot({
  development = typeof __DEV__ !== 'undefined' && __DEV__,
  platform = Platform.OS,
} = {}) {
  const explicit = configuredRoot();
  if (explicit) {
    if (!development && !explicit.startsWith('https://')) {
      throw new Error('Production SCHOOL_API_ROOT must use HTTPS.');
    }
    return `${explicit}/api`;
  }

  if (!development) {
    throw new Error(
      'Production SCHOOL_API_ROOT is not configured. Set the native SchoolManagementConfig.apiRoot value to the deployed HTTPS origin.',
    );
  }

  // Both physical Android devices and emulators use the same development
  // transport: adb reverse tcp:5000 tcp:5000. Metro's Wi-Fi host is independent
  // of API connectivity. Explicit configuration above still takes precedence.
  const host = platform === 'android' ? '127.0.0.1' : metroHost() || '127.0.0.1';
  return `http://${host}:${configuredPort()}/api`;
}

export const API_ROOT = resolveApiRoot();
