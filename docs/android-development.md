# Android local API development

Android debug builds use `http://127.0.0.1:5000/api`. ADB reverse forwards that
device loopback port to the laptop backend, independently of Metro's hostname
or the laptop's Wi-Fi IP. This works for physical devices and emulators while
ADB is connected.

```powershell
cd D:\schoolapp
adb devices
adb reverse tcp:5000 tcp:5000
adb reverse --list
```

Start the backend in its own terminal:

```powershell
cd D:\schoolapp\backend
npm run dev
```

Launch the debug app from another terminal:

```powershell
cd D:\schoolapp
npm run android
```

The `preandroid` npm hook runs `npm run android:prepare`, which establishes only
the TCP 5000 reverse mapping. It does not remove other mappings. Rerun
`npm run android:prepare` after reconnecting ADB or restarting the device.
ADB must be on PATH. If multiple devices are attached, select the intended
device with ADB's `ANDROID_SERIAL` environment variable and the React Native
CLI's `--device` option; use `npm run android -- --help` for the installed CLI.

An intentional `globalThis.__SCHOOL_API_ROOT__` or native
`SchoolManagementConfig.apiRoot` override still takes precedence. A non-default
development API port also needs its matching `adb reverse tcp:PORT tcp:PORT`.
Other development platforms retain Metro-host and loopback fallbacks.

Release builds require an explicit HTTPS API root. They never fall back to ADB,
Metro or an HTTP API. The existing React Native Gradle plugin supplies
`usesCleartextTraffic=true` for debug and `false` for release; no production
network policy change is necessary.

The API-config and Android login tests assert the actual imported development
root and outgoing `/api/auth/login` URL without logging session data. Login
transport, timeout, HTTP/authentication, and invalid-session errors remain
distinct. A working reverse mapping proves transport only; successful login
still requires valid account credentials and a valid server session response.
