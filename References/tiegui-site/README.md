# Tiegui Solutions

## Job Log operating rule
Nothing lives in texts or memory. Everything goes into the Job Log.

Marcus checks "New Lead" daily, updates Status + Next Action, and assigns owner.

## Setup note
Update `FORM_URL` in `src/App.jsx` with your live Google Form URL.

## Portal setup (Firebase Auth + Firestore)
1) Create a Firebase project (or reuse an existing one).
2) Enable Authentication:
   - Firebase Console → Authentication → Sign-in method → Email/Password → Enable.
3) Add web app config to `.env` (create this file):
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```
4) Add the allowlist emails in `src/portal/portalConfig.js` if they change.
5) Deploy Firestore rules (copy from `firestore.rules`):
   - Firebase Console → Firestore Database → Rules → Paste → Publish.

Portal routes:
- /portal/login
- /portal
