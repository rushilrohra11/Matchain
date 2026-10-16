import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

export const isFirebaseConfigured = Boolean(
  apiKey &&
  projectId &&
  apiKey !== 'YOUR_FIREBASE_API_KEY' &&
  !apiKey.includes('YOUR_')
);

const firebaseConfig = {
  apiKey: apiKey || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'matchain-dev.firebaseapp.com',
  projectId: projectId || 'matchain-dev',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'matchain-dev.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '10155756668',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:10155756668:web:59de2bc6b7be5ae8c30df9',
};

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseConfigured) {
  try {
    appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    authInstance = getAuth(appInstance);
    // Explicitly configure browserLocalPersistence so users stay logged in across browser closes
    setPersistence(authInstance, browserLocalPersistence).catch((err) => {
      console.warn('Could not enable browserLocalPersistence:', err);
    });
    dbInstance = getFirestore(appInstance);
  } catch (err) {
    console.error('Failed to initialize Firebase with provided credentials:', err);
  }
}

export const app = appInstance as FirebaseApp;
export const auth = authInstance as Auth;
export const db = dbInstance as Firestore;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
