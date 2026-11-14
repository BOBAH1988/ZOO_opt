import { useState } from 'react';
import { sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { Footer } from '@/components/Footer';

/** Превращает ошибку Firebase Auth в понятное русское сообщение. */
function formatAuthError(err: unknown, action: 'входа' | 'регистрации' | 'сброса пароля'): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code) : '';
  const base = `Ошибка ${action}: `;
  switch (code) {
    case 'auth/user-not-found':
      return base + 'Пользователь с таким email не найден.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return base + 'Неверный email или пароль.';
    case 'auth/invalid-email':
      return base + 'Email указан некорректно.';
    case 'auth/user-disabled':
      return base + 'Аккаунт отключён.';
    case 'auth/too-many-requests':
      return base + 'Слишком много попыток. Попробуйте позже.';
    case 'auth/email-already-in-use':
      return base + 'Этот email уже зарегистрирован. Войдите или используйте другой email.';
    case 'auth/weak-password':
      return base + 'Пароль слишком простой (минимум 6 символов).';
    case 'auth/operation-not-allowed':
      return base + 'Метод входа не включён в Firebase Console. Включите Email/Password провайдер.';
    case 'auth/network-request-failed':
      return base + 'Проблема с сетью. Проверьте подключение.';
    case 'auth/unauthorized-domain':
      return base + 'Домен не разрешён в Firebase Authentication.';
    default: {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка.';
      return base + message;
    }
  }
}

const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS || '')
  .split(',')
  .map((s: string) => s.trim().toLowerCase())
  .filter(Boolean);
const ALLOWED_DOMAINS = (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS || '')
  .split(',')
  .map((s: string) => s.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);
const INVITE_CODE = (import.meta.env.VITE_REGISTRATION_INVITE_CODE || '').trim();
const SIGNUP_DISABLED = (import.meta.env.VITE_DISABLE_SIGNUP || '').toLowerCase() === 'true';

function canRegisterEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (ALLOWED_EMAILS.length > 0) return ALLOWED_EMAILS.includes(normalized);
  if (ALLOWED_DOMAINS.length > 0) return ALLOWED_DOMAINS.some((d: string) => normalized.endsWith(`@${d}`));
  return true;
}

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signUp } = useAuth();

  const validate = (): string | null => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Введите корректный email';
    if (!password || password.length < 6) return 'Пароль должен быть не короче 6 символов';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); setInfo(null); return; }
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      const user = auth?.currentUser ?? undefined;
      if (user && !(user as { emailVerified?: boolean }).emailVerified) {
        setInfo('Вход выполнен, но email не подтверждён. Проверьте почту и подтвердите аккаунт.');
      }
      onLogin();
    } catch (err: unknown) {
      setError(formatAuthError(err, 'входа'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async () => {
    const v = validate();
    if (v) { setError(v); setInfo(null); return; }
    if (SIGNUP_DISABLED) {
      setError('Регистрация отключена. Обратитесь к администратору.');
      return;
    }
    if (INVITE_CODE && inviteCode.trim() !== INVITE_CODE) {
      setError('Неверный код приглашения.');
      return;
    }
    if (!canRegisterEmail(email)) {
      setError('Регистрация с этим email не разрешена. Используйте разрешённый рабочий адрес.');
      return;
    }
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await signUp(email, password);
      if (auth?.currentUser) {
        try {
          await sendEmailVerification(auth.currentUser);
          setInfo('Аккаунт создан. Письмо для подтверждения email отправлено (если включено в Firebase).');
        } catch {
          setInfo('Аккаунт создан. Подтвердите email в настройках аккаунта, если это требуется в вашем проекте.');
        }
      } else {
        setInfo('Аккаунт создан.');
      }
      const newUser = auth?.currentUser ?? undefined;
      if (newUser && !(newUser as { emailVerified?: boolean }).emailVerified) {
        setInfo('Email не подтверждён.');
      }
      onLogin();
    } catch (err: unknown) {
      setError(formatAuthError(err, 'регистрации'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Введите корректный email для сброса пароля.');
      setInfo(null);
      return;
    }
    if (!auth) { setError('Firebase не инициализирован'); return; }
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo('Письмо для сброса пароля отправлено, если аккаунт с таким email существует.');
    } catch (err: unknown) {
      setError(formatAuthError(err, 'сброса пароля'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isFirebaseConfigured()) {
    return (
      <div className="card">
        <h2 className="card-title">Вход в систему</h2>
        <div className="alert alert-warning">
          Firebase не сконфигурирован. Задайте переменные окружения VITE_FIREBASE_* (apiKey, authDomain, projectId, appId) и пересоберите проект.
        </div>
      </div>
    );
  }

  const signupRestricted = SIGNUP_DISABLED || ALLOWED_EMAILS.length > 0 || ALLOWED_DOMAINS.length > 0 || Boolean(INVITE_CODE);

  return (
    <div className="auth-page">
      <div className="auth-header">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="ЗооКонтроль" className="auth-logo" />
        <h1 className="auth-title">ЗооКонтроль</h1>
        <p className="auth-subtitle">Клиенты • Отчёты • KPI • Автоматизация</p>
      </div>
      <div className="card" style={{ maxWidth: 420, margin: '24px auto 0' }}>
        <h2 className="card-title">Вход в систему</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        {info && <div className="alert alert-info">{info}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input className="form-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {INVITE_CODE && (
            <div className="form-group">
              <label className="form-label">Код приглашения (для регистрации)</label>
              <input className="form-input" type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="off" />
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Вход…' : 'Войти'}
          </button>
        </form>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" onClick={handleResetPassword} className="btn btn-outline btn-sm" disabled={submitting}>
            Сбросить пароль
          </button>
          {!SIGNUP_DISABLED && (
            <button type="button" onClick={handleSignup} className="btn btn-outline btn-sm" disabled={submitting}>
              Зарегистрироваться
            </button>
          )}
        </div>
        {signupRestricted && !SIGNUP_DISABLED && (
          <p style={{ marginTop: 10, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
            Регистрация может быть ограничена списком разрешённых адресов или кодом приглашения.
          </p>
        )}
        {SIGNUP_DISABLED && (
          <p style={{ marginTop: 10, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
            Самостоятельная регистрация отключена. Уточните доступ у администратора.
          </p>
        )}
        <p style={{ marginTop: 10, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
          Доступ возможен только после авторизации.
        </p>
      </div>
      <Footer />
    </div>
  );
}