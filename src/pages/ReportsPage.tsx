import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { EmptyState } from '@/components/EmptyState';
import { ProgressRing } from '@/components/ProgressRing';
import { mapClientDoc, toIsoString } from '@/lib/clientData';
import type { Client, RunLog } from '@/types';

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
    createdAt: toIsoString(d.createdAt),
  };
}

export function ReportsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ left: number; top: number; message: string } | null>(null);
  const [page, setPage] = useState(0);
  const tipRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 3;
  const prevPage = () => setPage((p) => Math.max(0, p - 1));
  const nextPage = () => setPage((p) => {
    const maxPage = Math.max(0, Math.ceil(logs.length / PAGE_SIZE) - 1);
    return Math.min(maxPage, p + 1);
  });

  const pagedLogs = logs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    const onDocClick = () => setTooltip(null);
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(logs.length / PAGE_SIZE) - 1);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [logs.length, page]);

  useEffect(() => {
    if (!tooltip || !tipRef.current) return;
    const el = tipRef.current;
    const raf = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      let left = tooltip.left;
      let top = tooltip.top;
      if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
      if (left < 0) left = 0;
      if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height;
      if (top < 0) top = 0;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [tooltip]);

  useEffect(() => {
    if (!user) {
      setLogs([]);
      setLoading(false);
      return;
    }
    if (!isFirebaseConfigured() || !db) {
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

  useEffect(() => {
    if (!user) {
      setClients([]);
      setClientsLoading(false);
      return;
    }
    if (!isFirebaseConfigured() || !db) {
      setClientsLoading(false);
      return;
    }
    setClientsLoading(true);
    const q = query(
      collection(db, 'clients'),
      where('ownerUid', '==', user.uid),
      orderBy('updatedAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Client[] = [];
        snapshot.forEach((snap) => {
          const mapped = mapClientDoc(snap);
          if (mapped) list.push(mapped);
        });
        setClients(list);
        setClientsLoading(false);
      },
      (_err) => {
        setClientsLoading(false);
      },
    );
    return () => unsub();
  }, [user]);

  const activeCount = useMemo(() => clients.filter((c) => c.active).length, [clients]);
  const activeShare = useMemo(() => (clients.length > 0 ? activeCount / clients.length : 0), [clients, activeCount]);

  if (!isFirebaseConfigured() || !db) {
    return (
      <div className="card">
        <h2 className="card-title">Главная</h2>
        <div className="alert alert-warning">Firebase не сконфигурирован. История запусков будет доступна после настройки Firestore.</div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {!clientsLoading && (
        <>
          {/* Блок KPI: данные ещё не подключены (раздел в разработке). */}
          <div style={{ fontSize: 16, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text)', marginBottom: 8 }}>KPI</div>
          <div className="card" style={{ marginTop: 12, marginBottom: 12, padding: 12 }}>
            <div className="stats-row">
              <div className="stat-tile">
                <div className="stat-label">Общий план</div>
                <div className="stat-value">—</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Общий факт</div>
                <div className="stat-value stat-value--success">—</div>
              </div>
              <div className="stat-tile">
                <ProgressRing percent={null} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 8, textAlign: 'center' }}>
              Данные KPI появятся после запуска процесса «KPI Продажи».
            </div>
          </div>
          {/* Блок АКБ (активная клиентская база) */}
          <div style={{ fontSize: 16, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text)', marginBottom: 8 }}>АКБ</div>
          <div className="card" style={{ marginTop: 12, marginBottom: 12, padding: 12 }}>
            <div className="stats-row">
              <div className="stat-tile">
                <div className="stat-label">Всего</div>
                <div className="stat-value">{clients.length}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Активных</div>
                <div className="stat-value stat-value--success">{activeCount}</div>
              </div>
              <div className="stat-tile">
                <ProgressRing percent={activeShare} />
              </div>
            </div>
          </div>
        </>
      )}
      {loading ? (
        <div className="card"><p style={{ textAlign: 'center', color: '#6b7280', padding: 24 }}>Загрузка истории…</p></div>
      ) : pagedLogs.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Запусков пока нет"
            description="Здесь отображается история запросов на запуск процессов, их статусы, ошибки и ссылки на результаты в GitHub Actions."
          />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>История запусков</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-outline btn-sm" onClick={prevPage} disabled={page === 0}>←</button>
              <button className="btn btn-outline btn-sm" onClick={nextPage} disabled={(page + 1) * PAGE_SIZE >= logs.length}>→</button>
            </div>
          </div>
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
                {pagedLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12, lineHeight: 1 }}>
                      {log.createdAt ? (
                        <>
                          <div style={{ fontWeight: 600 }}>
                            {(() => {
                              const d = new Date(log.createdAt);
                              return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
                            })()}
                          </div>
                          <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
                            {(() => {
                              const d = new Date(log.createdAt);
                              return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('ru-RU');
                            })()}
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
                          const row = (e.target as HTMLElement).closest('tr');
                          if (!row) return;
                          const rect = row.getBoundingClientRect();
                          setTooltip({
                            left: rect.left,
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
                  maxWidth: '60vw',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  pointerEvents: 'auto',
                  left: tooltip.left,
                  top: tooltip.top,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}
              >
                {tooltip.message}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}