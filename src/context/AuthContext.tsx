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
import { auth, initFirebase, reloadUser, getIdToken } from '@/firebase';
import { firebaseConfig, getFirebaseConfigIssues } from '@/firebase.config';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  firebaseError: string | null;
  emailVerified: boolean | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Перечитывает пользователя из Firebase и возвращает актуальный emailVerified. */
  refreshEmailVerification: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Через сколько миллисекунд прекращать «вечную загрузку», если Firebase не ответил. */
const AUTH_INIT_TIMEOUT_MS = 8000;

/**
 * Читает сохранённого пользователя из localStorage Firebase Auth.
 * Позволяет показать приложение сразу при обновлении страницы, не дожидаясь,
 * пока SDK проверит токен по сети (на медленном соединении это занимает секунды).
 */
function readCachedAuthUser(apiKey: string): User | null {
  if (!apiKey) return null;
  try {
    const raw = window.localStorage.getItem(`firebase:authUser:${apiKey}:[DEFAULT]`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { uid?: unknown };
    if (typeof parsed?.uid !== 'string' || !parsed.uid) return null;
    return parsed as unknown as User;
  } catch {
    return null;
  }
}

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

    // Возвращающийся пользователь: показываем приложение сразу по данным из кэша,
    // а реальное состояние из Firebase применим, когда SDK ответит.
    const cachedUser = readCachedAuthUser(firebaseConfig.apiKey);
    if (cachedUser) {
      setUser(cachedUser);
      setEmailVerified(cachedUser.emailVerified);
      setInitialized(true);
      setLoading(false);
    }

    // Если браузер явно offline, не ждём сетевой таймаут Firebase.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFirebaseError('Нет подключения к интернету. Проверьте сеть и обновите страницу.');
      setInitialized(true);
      setLoading(false);
    }

    // Страховка от бесконечной загрузки: если Firebase недоступен (нет сети/DNS),
    // через несколько секунд показываем экран входа с понятным сообщением об ошибке.
    const timeoutId = window.setTimeout(() => {
      setFirebaseError((previous) =>
        previous ?? 'Не удалось подключиться к Firebase. Проверьте интернет-соединение и повторите попытку.',
      );
      setInitialized(true);
      setLoading(false);
    }, AUTH_INIT_TIMEOUT_MS);

    const unsub = onAuthStateChanged(a, (u) => {
      window.clearTimeout(timeoutId);
      setUser(u);
      setEmailVerified(u?.emailVerified ?? null);
      setFirebaseError(null);
      setLoading(false);
      setInitialized(true);
    });

    return () => {
      window.clearTimeout(timeoutId);
      unsub();
    };
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

  const refreshEmailVerification = async (): Promise<boolean> => {
    const current = auth?.currentUser;
    if (!current) return false;
    await reloadUser(current);
    const verified = Boolean(current.emailVerified);
    if (verified) {
      // Свежий токен, чтобы правила Firestore увидели email_verified без перелогина.
      await getIdToken(current, true);
    }
    setEmailVerified(verified);
    return verified;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        emailVerified,
        loading,
        initialized,
        firebaseError,
        signIn,
        signUp,
        signOut: signOutFn,
        refreshEmailVerification,
      }}
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
