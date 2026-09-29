# School App – Role Separated (Fixed)

## Kya ready hai

- Principal / Super Admin / Teacher / Student / Parent / Accountant **alag-alag** navigators
- Login = **role picker** (email/password temporarily band)
- `backend/.env` already connected (demo MongoDB settings)
- Tests updated for new structure

## Sirf yeh karo

1. Is folder ko extract / copy karo apne project path pe  
   (e.g. `D:\work\Apps\School app\SchoolPlatform`)

2. **Sirf env replace** (agar chaho to):
   ```
   backend/.env
   ```
   Abhi yeh values set hain:
   ```
   NODE_ENV=development
   JWT_SECRET=dev-school-platform-secret-change-me-later-32chars
   MONGODB_URI=mongodb://127.0.0.1:27017/school_platform_demo
   DEMO_MONGODB_URI=mongodb://127.0.0.1:27017/school_platform_demo
   ALLOW_DEMO_SEED=true
   BOOTSTRAP_EMAIL=admin@example.test
   BOOTSTRAP_PASSWORD=DevAdmin123!
   ```
   Apni MongoDB / password change karna ho to sirf yeh file edit karo.

3. Install + run:
   ```bash
   cd backend
   npm install
   npm run seed:dev    # optional
   npm run dev

   # dusri terminal
   npm install
   npm start
   yarn android
   ```

4. Phone pe app kholo → role choose karo → UI order change start karo.

## Note

- Real login baad mein wapas laga denge.
- Phone se API ke liye: `adb reverse tcp:4000 tcp:4000`
