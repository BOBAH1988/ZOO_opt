import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  reload,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  enableNetwork,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from './firebase.config';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let firestoreReady = false;
let firestoreError: string | null = null;

export function initFirebase() {
  if (!isFirebaseConfigured()) {
    firestoreReady = false;
    firestoreError = 'Firebase не сконфигурирован. Задайте переменные окружения VITE_FIREBASE_* (apiKey, authDomain, projectId, appId и т.д.) и пересоберите проект.';
    return { app: null, auth: null, db: null };
  }

  try {
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }

    auth = getAuth(app);
    db = getFirestore(app);

    firestoreReady = true;
    firestoreError = null;

    return { app, auth, db };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    firestoreReady = false;
    firestoreError = `Ошибка инициализации Firebase: ${message}`;
    console.error(firestoreError);
    return { app: null, auth: null, db: null };
  }
}

export function getFirestoreStatus(): { ready: boolean; error: string | null } {
  return { ready: firestoreReady, error: firestoreError };
}

export async function testFirestoreConnection(): Promise<{ ok: boolean; error: string | null }> {
  if (!isFirebaseConfigured()) {
    return {
      ok: false,
      error: 'Firebase не сконфигурирован. Проверьте VITE_FIREBASE_* переменные.',
    };
  }

  if (!db) {
    return {
      ok: false,
      error: 'Firestore не инициализирован. Вызовите initFirebase().',
    };
  }

  try {
    await enableNetwork(db);
    return { ok: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    firestoreReady = false;
    firestoreError = `Ошибка подключения к Firestore: ${message}`;
    return { ok: false, error: firestoreError };
  }
}

/** Перечитывает профиль пользователя из Firebase Auth (обновляет emailVerified). */
export async function reloadUser(user: User): Promise<void> {
  await reload(user);
}

/** Возвращает ID token, принудительно обновляя его при forceRefresh=true. */
export async function getIdToken(user: User, forceRefresh = false): Promise<string> {
  return user.getIdToken(forceRefresh);
}

export { app, auth, db };

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
};
export type { User, DocumentData, QueryDocumentSnapshot, Firestore, Auth };