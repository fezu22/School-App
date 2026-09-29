# School Platform backend

This folder contains the Express API and its MongoDB configuration, separate from the React Native app files.

## Run the API

From this folder, run `npm ci` once and then `npm start`. The API listens on port 4000. Keep the terminal open while using the mobile app.

For an Android device connected over USB or wireless ADB, run `adb reverse tcp:4000 tcp:4000` so the app's `http://localhost:4000` API address reaches this computer. Android emulator users can use `http://10.0.2.2:4000` instead.

Private MongoDB credentials and the bootstrap administrator password are stored in `.env`; use `.env.example` as the template for another machine.
