import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isFirebaseConfigured } from '@/firebase.config';
import { Footer } from '@/components/Footer';

/** Превращает ошибку Firebase Auth в понятное русское сообщение. */
function formatAuthError(err: any, action: 'входа' | 'регистрации'): string {
  const code = err?.code || '';
  const base = `Ошибка ${action}: `;
  switch (code) {
    case 'auth/user-not-found':
      return base + 'Пользователь с таким email не найден.';
    case 'auth/wrong-password':
      return base + 'Неверный пароль.';
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
    case 'auth/internal-error':
      return base + 'Внутренняя ошибка Firebase. Проверьте, что Email/Password провайдер включён и пароль соответствует требованиям.';
    default:
      return base + (err?.message || 'Неизвестная ошибка.');
  }
}

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signUp } = useAuth();

  const validate = (): string | null => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return 'Введите корректный email';
    }
    if (!password || password.length < 6) {
      return 'Пароль должен быть не короче 6 символов';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      onLogin();
    } catch (err: any) {
      setError(formatAuthError(err, 'входа'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signUp(email, password);
      onLogin();
    } catch (err: any) {
      setError(formatAuthError(err, 'регистрации'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isFirebaseConfigured()) {
    return (
      <div className="card">
        <h2 className="card-title">Вход в систему</h2>
        <div className="alert alert-warning">
          Firebase не сконфигурирован. Задайте переменные окружения VITE_FIREBASE_*
          (apiKey, authDomain, projectId, appId и т.д.) и пересоберите проект.
          Подробнее — в разделе «Настройка для публикации» README.
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-header">
        <img src="/ZOO_opt/icon.svg" alt="ЗооКонтроль" className="auth-logo" />
        <h1 className="auth-title">ЗооКонтроль</h1>
        <p className="auth-subtitle">Клиенты • Отчёты • KPI • Автоматизация</p>
      </div>
      <div className="card" style={{ maxWidth: 400, margin: '24px auto 0' }}>
        <h2 className="card-title">Вход в систему</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={(e) => handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input className="form-input" type="password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Вход…' : 'Войти'}
          </button>
        </form>
        <p style={{ marginTop: 14, fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
          Нет аккаунта?{' '}
          <button type="button" onClick={() => handleSignup()}
            className="btn btn-outline" style={{ padding: 4, marginLeft: 0, background: 'transparent', borderColor: 'transparent', color: 'var(--color-primary)' }} disabled={submitting}>
            Зарегистрироваться
          </button>
        </p>
        <p style={{ marginTop: 10, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
          Доступ возможен только после авторизации.
        </p>
      </div>
      <Footer />
    </div>
  );
}