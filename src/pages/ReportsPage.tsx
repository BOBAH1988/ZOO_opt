import { useEffect, useRef, useState } from 'react';
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
  const [tooltip, setTooltip] = useState<{ right: number; top: number; message: string } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = () => setTooltip(null);
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!tooltip || !tipRef.current) return;
    const el = tipRef.current;
    const raf = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      let right = tooltip.right;
      if (rect.width > right) right = rect.width;
      let top = tooltip.top;
      if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height;
      if (top < 0) top = 0;
      el.style.right = `${right}px`;
      el.style.top = `${top}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [tooltip]);

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
                    <span
                      className={`badge ${log.status === 'accepted' ? 'bg-test' : 'bg-real'}`}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const badge = e.currentTarget as HTMLElement;
                        const rect = badge.getBoundingClientRect();
                        setTooltip({
                          right: window.innerWidth - rect.left,
                          top: rect.top,
                          message: log.message,
                        });
                      }}
                    >
                      {log.status === 'accepted' ? 'Ок' : 'Сбой'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tooltip && (
            <div
              ref={tipRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                zIndex: 50,
                background: '#111',
                color: '#fff',
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.4,
                maxWidth: 300,
                whiteSpace: 'pre-wrap',
                pointerEvents: 'auto',
                right: Math.min(Math.max(0, tooltip.right), window.innerWidth),
                top: Math.min(Math.max(0, tooltip.top), window.innerHeight),
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              {tooltip.message}
            </div>
          )}
          <p style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
            Статус «Ок» означает, что сервер принял запрос. Фактическое выполнение и итог смотрите в GitHub Actions.
          </p>
        </div>
      )}
    </div>
  );
}