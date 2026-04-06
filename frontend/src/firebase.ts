import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const requiredEnv = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const missing = requiredEnv.filter((key) => {
  const value = import.meta.env[key];
  return !value || value.trim().length === 0;
});

let firebaseApp: FirebaseApp | null = null;
let appAuth: Auth | null = null;
let appDb: Firestore | null = null;
let appStorage: FirebaseStorage | null = null;

if (missing.length === 0) {
  firebaseApp = initializeApp(firebaseConfig);
  appAuth = getAuth(firebaseApp);
  appDb = getFirestore(firebaseApp);
  appStorage = getStorage(firebaseApp);
}

export { appAuth, appDb, appStorage, firebaseApp };

export const firebaseConfigStatus = {
  isValid: missing.length === 0,
  missing,
};
