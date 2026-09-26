# School Platform backend

This folder contains the Express API and its MongoDB configuration, separate from the React Native app files.

## Run the API

From this folder, run `npm ci` once and then `npm start`. The API listens on port 4000. Keep the terminal open while using the mobile app.

For an Android device connected over USB or wireless ADB, run `adb reverse tcp:4000 tcp:4000` so the app's `http://localhost:4000` API address reaches this computer. Android emulator users can use `http://10.0.2.2:4000` instead.

Private MongoDB credentials and the bootstrap administrator password are stored in `.env`; use `.env.example` as the template for another machine.

## Fees foundation

Amounts in the API are integer paisa (100 paisa = PKR 1). The Super Admin can set an invoice concession with a reason and refund only the resulting excess credit, linked to an original payment. Both payments and refunds require a unique `requestKey` for safe retries. Accountants can record payments and close daily cash for their assigned branches; the Super Admin can do so for every branch. Parents and students can read only their accessible invoice ledger.

Cash closing uses a UTC calendar day per branch. The expected count includes that day's CASH payments minus CASH refunds. The physical count, variance, and close time are retained; subsequent CASH payments or CASH refunds for the same branch and day are blocked. BANK and CHEQUE entries remain open. These operations require MongoDB transactions on a replica set. This is a basic branch closing flow, not a cashier register handover or bank reconciliation. Printed vouchers and receipts are still pending.
