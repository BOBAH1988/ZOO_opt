import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { EmptyState } from '@/components/EmptyState';
import { toIsoString } from '@/lib/clientData';
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
    setPage(0);
  }, [logs.length]);

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
          const data = snap.data() as unknown as Client & { ownerUid?: unknown };
          if (typeof data.name !== 'string' || !data.name.trim()) return;
          if (typeof data.email !== 'string' || !data.email.trim()) return;
          if (typeof data.ownerUid !== 'string' || !data.ownerUid) return;
          list.push({
            id: snap.id,
            name: data.name.trim(),
            email: data.email.trim(),
            phone: typeof data.phone === 'string' && data.phone.trim() ? data.phone.trim() : undefined,
            company: typeof data.company === 'string' && data.company.trim() ? data.company.trim() : undefined,
            address: typeof data.address === 'string' && data.address.trim() ? data.address.trim() : undefined,
            day: typeof data.day === 'string' && data.day.trim() ? data.day.trim() : undefined,
            mode: typeof data.mode === 'string' && data.mode.trim() ? data.mode.trim() : undefined,
            manager: typeof data.manager === 'string' && data.manager.trim() ? data.manager.trim() : undefined,
            notes: typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : undefined,
            active: typeof data.active === 'boolean' ? data.active : true,
            createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
            updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
            ownerUid: data.ownerUid,
          });
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
          {/* Блок KPI */}
          <div style={{ fontSize: 16, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text)', marginBottom: 8 }}>KPI</div>
          <div className="card" style={{ marginTop: 12, marginBottom: 12, padding: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'nowrap' }}>
            <div style={{ flex: 1, minWidth: 0, padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>Общий план</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>—</div>
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>Ощий факт</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-success)' }}>—</div>
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', border: '4px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', margin: '0 auto' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="12" cy="12" r="10" stroke="var(--color-border)" strokeWidth="4" fill="none" />
                  <circle cx="12" cy="12" r="10" stroke="#2563eb" strokeWidth="4" fill="none" strokeDasharray="62.8" strokeDashoffset="62.8" />
                </svg>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>0%</div>
              </div>
            </div>
          </div>
          </div>
          {/* Блок АКБ */}
          <div style={{ fontSize: 16, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text)', marginBottom: 8 }}>АКБ</div>
          <div className="card" style={{ marginTop: 12, marginBottom: 12, padding: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'nowrap' }}>
            <div style={{ flex: 1, minWidth: 0, padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>Всего</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>{clients.length}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>Активных</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-success)' }}>{clients.filter((c) => c.active).length}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 10, background: 'var(--color-bg)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', border: '4px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', margin: '0 auto' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="12" cy="12" r="10" stroke="var(--color-border)" strokeWidth="4" fill="none" />
                  <circle cx="12" cy="12" r="10" stroke="#2563eb" strokeWidth="4" fill="none" strokeDasharray="62.8" strokeDashoffset="0" />
                </svg>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{clients.length > 0 ? 100 : 0}%</div>
              </div>
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
                          {new Date(log.createdAt).toLocaleDateString('ru-RU')}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
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
                whiteSpace: 'nowrap',
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