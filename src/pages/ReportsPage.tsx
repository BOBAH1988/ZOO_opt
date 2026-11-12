import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { EmptyState } from '@/components/EmptyState';
import type { RunLog } from '@/types';

function toIso(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try { return (value as { toDate: () => Date }).toDate().toISOString(); } catch { return ''; }
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return '';
}

function docToLog(snap: QueryDocumentSnapshot<DocumentData>): RunLog | null {
  const d = snap.data();
  if (typeof d.workflowId !== 'string' || typeof d.workflowName !== 'string') return null;
  if (d.status !== 'accepted' && d.status !== 'error') return null;
  if (typeof d.message !== 'string') return null;
  if (typeof d.requestedBy !== 'string') return null;
  const inputs = d.inputs && typeof d.inputs === 'object' && !Array.isArray(d.inputs) ? (d.inputs as Record<string, boolean | string>) : {};
  return {
    id: snap.id,
    workflowId: d.workflowId,
    workflowName: d.workflowName,
    status: d.status,
    message: d.message,
    runUrl: typeof d.runUrl === 'string' ? d.runUrl : null,
    requestedBy: d.requestedBy,
    requestedByEmail: typeof d.requestedByEmail === 'string' ? d.requestedByEmail : null,
    inputs,
    createdAt: toIso(d.createdAt),
  };
}

export function ReportsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured() || !db || !user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const q = query(
      collection(db, 'runLogs'),
      where('requestedBy', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: RunLog[] = [];
        snapshot.forEach((snap) => {
          const parsed = docToLog(snap);
          if (parsed) list.push(parsed);
        });
        setLogs(list);
        setLoading(false);
      },
      (err) => {
        setError(err?.message || 'Ошибка загрузки истории запусков');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user]);

  if (!isFirebaseConfigured() || !db) {
    return (
      <div className="card">
        <h2 className="card-title">Отчёты</h2>
        <div className="alert alert-warning">Firebase не сконфигурирован. История запусков будет доступна после настройки Firestore.</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Отчёты и история запусков</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="card"><p style={{ textAlign: 'center', color: '#6b7280', padding: 24 }}>Загрузка истории…</p></div>
      ) : logs.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Запусков пока нет"
            description="Здесь отображается история запросов на запуск процессов, их статусы, ошибки и ссылки на результаты в GitHub Actions."
          />
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Процесс</th>
                <th>Статус</th>
                <th>Сообщение</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td style={{ fontSize: 12, lineHeight: 1 }}>
                    {log.createdAt ? (
                      <>
                        <div style={{ fontWeight: 600 }}>
                          {new Date(log.createdAt).toLocaleDateString('ru-RU')}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: 11 }}>
                          {new Date(log.createdAt).toLocaleTimeString('ru-RU')}
                        </div>
                      </>
                    ) : '—'}
                  </td>
                  <td>{log.workflowName}</td>
                  <td>
                    <span className={`badge ${log.status === 'accepted' ? 'bg-test' : 'bg-real'}`}>
                      {log.status === 'accepted' ? 'Ок' : 'Сбой(ошибка)'}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{log.message}</td>
                  <td>
                    {log.runUrl ? (
                      <a href={log.runUrl} target="_blank" rel="noopener noreferrer">GitHub Actions</a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
            Статус «принят» означает, что сервер принял запрос. Фактическое выполнение и итог смотрите в GitHub Actions.
          </p>
        </div>
      )}
    </div>
  );
}