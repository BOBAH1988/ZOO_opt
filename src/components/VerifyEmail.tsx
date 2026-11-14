import { useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { useAuth } from '@/context/AuthContext';
import { Footer } from '@/components/Footer';

/**
 * Экран для пользователя, который вошёл, но ещё не подтвердил email.
 *
 * Показывается вместо приложения, поэтому у пользователя есть понятная
 * инструкция и кнопки «отправить письмо ещё раз» / «проверить подтверждение».
 */
export function VerifyEmail() {
  const { user, signOut, refreshEmailVerification } = useAuth();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await sendEmailVerification(user);
      setInfo('Письмо отправлено. Проверьте почту и папку «Спам».');
    } catch (err: unknown) {
      const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code) : '';
      if (code === 'auth/too-many-requests') {
        setError('Слишком много попыток. Попробуйте позже.');
      } else {
        setError(err instanceof Error ? err.message : 'Не удалось отправить письмо.');
      }
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const verified = await refreshEmailVerification();
      if (!verified) {
        setError('Email пока не подтверждён. Откройте письмо и перейдите по ссылке.');
      }
    } catch {
      setError('Не удалось проверить статус. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-header">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="ЗооКонтроль" className="auth-logo" />
        <h1 className="auth-title">ЗооКонтроль</h1>
      </div>
      <div className="card" style={{ maxWidth: 460, margin: '24px auto 0' }}>
        <h2 className="card-title">Подтвердите email</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        {info && <div className="alert alert-info">{info}</div>}
        <div className="alert alert-warning">
          Аккаунт <strong>{user?.email || '—'}</strong> создан, но почта ещё не подтверждена.
          Доступ к данным и запуску процессов откроется после перехода по ссылке из письма.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn btn-primary" type="button" onClick={check} disabled={busy}>
            {busy ? 'Проверка…' : 'Я подтвердил(а) — проверить'}
          </button>
          <button className="btn btn-outline" type="button" onClick={resend} disabled={busy}>
            Отправить письмо ещё раз
          </button>
          <button className="btn btn-outline" type="button" onClick={() => void signOut()} disabled={busy}>
            Выйти
          </button>
        </div>
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'center' }}>
          Если письма нет — проверьте папку «Спам» или запросите новое.
        </p>
      </div>
      <Footer />
    </div>
  );
}
