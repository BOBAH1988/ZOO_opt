import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth, initFirebase } from '@/firebase';
import { getFirebaseConfigIssues } from '@/firebase.config';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  firebaseError: string | null;
  emailVerified: boolean | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);

  useEffect(() => {
    const { auth: a } = initFirebase();
    if (!a) {
      const missing = getFirebaseConfigIssues();
      setFirebaseError(
        missing.length
          ? `Не заданы переменные окружения: ${missing.join(', ')}. Настройте их в .env и пересоберите проект.`
          : 'Firebase не инициализирован.',
      );
      setInitialized(true);
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(a, (u) => {
      setUser(u);
      setEmailVerified(u?.emailVerified ?? null);
      setLoading(false);
      setInitialized(true);
    });

    return () => unsub();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase не инициализирован');
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase не инициализирован');
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const signOutFn = async () => {
    if (!auth) throw new Error('Firebase не инициализирован');
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, emailVerified, loading, initialized, firebaseError, signIn, signUp, signOut: signOutFn }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return ctx;
}