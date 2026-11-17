import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { ProgressRing } from '@/components/ProgressRing';
import { mapClientDoc } from '@/lib/clientData';
import type { Client } from '@/types';

export function ReportsPage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);

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
    </div>
  );
}