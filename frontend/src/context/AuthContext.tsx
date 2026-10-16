import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db, googleProvider, isFirebaseConfigured } from '../lib/firebase';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  role: string;
  organization?: string;
  walletAddress?: string | null;
  createdAt?: any;
  lastLoginAt?: any;
}

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  isConfigured: boolean;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string, role?: string, org?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  updateUserProfile: (data: { displayName?: string; role?: string; organization?: string }) => Promise<void>;
  linkWalletAddress: (address: string) => Promise<void>;
  formatAuthError: (error: any) => string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync with Firestore profile
  const fetchOrCreateProfile = async (firebaseUser: User, extra?: Partial<UserProfile>) => {
    if (!isFirebaseConfigured || !db) {
      setUserProfile({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: extra?.displayName || firebaseUser.displayName || 'Demo Scientist',
        role: extra?.role || 'Materials Scientist',
        organization: extra?.organization || 'Independent Lab',
        walletAddress: extra?.walletAddress || null,
      });
      return;
    }

    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const snapshot = await getDoc(userRef);

      if (snapshot.exists()) {
        const data = snapshot.data() as UserProfile;
        await updateDoc(userRef, { lastLoginAt: serverTimestamp() });
        setUserProfile({ ...data, lastLoginAt: new Date().toISOString() });
      } else {
        const newProfile: UserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: extra?.displayName || firebaseUser.displayName || (firebaseUser.email?.split('@')[0] ?? 'Researcher'),
          photoURL: firebaseUser.photoURL || null,
          role: extra?.role || 'Materials Scientist',
          organization: extra?.organization || 'Computational Chemistry Lab',
          walletAddress: extra?.walletAddress || null,
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        };
        await setDoc(userRef, newProfile);
        setUserProfile(newProfile);
      }
    } catch (err) {
      console.warn('Firestore profile fetch warning (using fallback profile):', err);
      setUserProfile({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: extra?.displayName || firebaseUser.displayName || 'Materials Researcher',
        role: extra?.role || 'Materials Scientist',
        organization: extra?.organization || 'Academic Lab',
        walletAddress: extra?.walletAddress || null,
      });
    }
  };

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await fetchOrCreateProfile(currentUser);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, pass: string) => {
    if (!isFirebaseConfigured || !auth) {
      throw new Error('Firebase setup required: Please add your Firebase credentials to frontend/.env.local.');
    }
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await fetchOrCreateProfile(cred.user);
  };

  const signUpWithEmail = async (email: string, pass: string, name: string, role = 'Materials Scientist', org = 'Academic Lab') => {
    if (!isFirebaseConfigured || !auth) {
      throw new Error('Firebase setup required: Please add your Firebase credentials to frontend/.env.local.');
    }
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await fetchOrCreateProfile(cred.user, { displayName: name, role, organization: org });
  };

  const signInWithGoogle = async () => {
    if (!isFirebaseConfigured || !auth) {
      throw new Error('Firebase setup required: Please add your Firebase credentials to frontend/.env.local.');
    }
    const cred = await signInWithPopup(auth, googleProvider);
    await fetchOrCreateProfile(cred.user);
  };

  const logOut = async () => {
    if (isFirebaseConfigured && auth) {
      await signOut(auth);
    }
    setUser(null);
    setUserProfile(null);
  };

  const updateUserProfile = async (data: { displayName?: string; role?: string; organization?: string }) => {
    if (!user) throw new Error('No user is currently logged in');

    // Update Firebase Auth displayName if provided
    if (data.displayName && auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: data.displayName });
    }

    // Update Firestore user document
    if (isFirebaseConfigured && db) {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        ...(data.displayName ? { displayName: data.displayName } : {}),
        ...(data.role ? { role: data.role } : {}),
        ...(data.organization ? { organization: data.organization } : {}),
        updatedAt: serverTimestamp(),
      });
    }

    // Update local state
    setUserProfile((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        displayName: data.displayName ?? prev.displayName,
        role: data.role ?? prev.role,
        organization: data.organization ?? prev.organization,
      };
    });
  };

  const linkWalletAddress = async (address: string) => {
    if (userProfile && user) {
      setUserProfile((prev) => (prev ? { ...prev, walletAddress: address } : null));
      if (isFirebaseConfigured && db) {
        try {
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, { walletAddress: address });
        } catch (e) {
          console.error('Failed to link wallet in Firestore:', e);
        }
      }
    }
  };

  const formatAuthError = (err: any): string => {
    const code = err?.code || '';
    switch (code) {
      case 'auth/email-already-in-use':
        return 'An account with this email already exists. Please sign in instead.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not enabled in your Firebase Console.';
      case 'auth/weak-password':
        return 'Password is too weak. Please use at least 6 characters.';
      case 'auth/user-disabled':
        return 'This user account has been disabled.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Invalid email or password. Please check your credentials.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in popup was closed before completing.';
      case 'auth/popup-blocked':
        return 'Popup was blocked by your browser. Please allow popups for this site.';
      case 'auth/cancelled-popup-request':
        return 'Another sign-in popup is already open.';
      case 'auth/network-request-failed':
        return 'Network error. Please check your internet connection.';
      default:
        return err?.message || 'An authentication error occurred. Please try again.';
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        loading,
        isConfigured: isFirebaseConfigured,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        logOut,
        updateUserProfile,
        linkWalletAddress,
        formatAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
