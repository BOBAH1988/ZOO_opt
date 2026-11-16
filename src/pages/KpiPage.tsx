import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { EmptyState } from '@/components/EmptyState';

type KpiRow = {
  name: string;
  plan: string | number;
  fact: string | number;
  stage: string | number;
  next_stage: string | number;
  remaining: string | number;
  accrued: string | number;
  proj_pct: string | number;
  projection: string | number;
};

type KpiReport = {
  id: string;
  ownerUid: string;
  createdAt: string;
  letterDate: string | null;
  result: { header: string; lines: KpiRow[] };
  html: string;
  plain: string;
  subject: string;
};

function docToReport(snap: QueryDocumentSnapshot<DocumentData>): KpiReport | null {
  const d = snap.data();
  if (typeof d.ownerUid !== 'string') return null;
  if (typeof d.result !== 'object' || d.result === null) return null;
  if (!Array.isArray(d.result.lines)) return null;
  if (typeof d.createdAt !== 'string' && !d.createdAt?.toDate) return null;

  const createdAt = d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : String(d.createdAt);

  return {
    id: snap.id,
    ownerUid: d.ownerUid,
    createdAt,
    letterDate: typeof d.letterDate === 'string' ? d.letterDate : null,
    result: d.result as { header: string; lines: KpiRow[] },
    html: typeof d.html === 'string' ? d.html : '',
    plain: typeof d.plain === 'string' ? d.plain : '',
    subject: typeof d.subject === 'string' ? d.subject : '',
  };
}

export function KpiPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<KpiReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setReports([]);
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
      collection(db, 'kpi_reports'),
      where('ownerUid', '==', user.email),
      orderBy('createdAt', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: KpiReport[] = [];
        snapshot.forEach((snap) => {
          const parsed = docToReport(snap);
          if (parsed) list.push(parsed);
        });
        setReports(list);
        setLoading(false);
      },
      (err) => {
        setError(err?.message || 'Ошибка загрузки отчётов KPI');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user, db]);

  const latest = reports[0];

  if (!isFirebaseConfigured() || !db) {
    return (
      <div className="card">
        <h2 className="card-title">KPI задачи</h2>
        <div className="alert alert-warning">Firebase не сконфигурирован. Данные KPI будут доступны после настройки Firestore.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h2 className="card-title">KPI задачи</h2>
        <div className="alert alert-info">Загрузка отчётов KPI…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2 className="card-title">KPI задачи</h2>
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="card">
        <h2 className="card-title">KPI задачи</h2>
        <EmptyState
          title="Отчётов KPI пока нет"
          description="Запустите процесс «KPI Продажи» на странице «Запуск процессов», и отчёт появится здесь."
        />
      </div>
    );
  }

  const rows = latest.result.lines;
  const totalRow = rows.find((r) => r.name === 'ИТОГО');
  const detailRows = rows.filter((r) => r.name !== 'ИТОГО');

  const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU');
  };

  const cell = (v: string | number) => String(v === null || v === undefined ? '—' : v);

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="card">
        <h2 className="card-title">KPI задачи</h2>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
          Последний отчёт: {fmtDate(latest.createdAt)}
        </div>

        <div style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word' }}>
          {latest.result.header}
        </div>

        {totalRow && (
          <div style={{ fontSize: 13, fontWeight: 600, color: '#14532d' }}>
            Итого {cell(totalRow.accrued).replace(/ с$/, '')}
          </div>
        )}
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Направление</th>
                <th>План</th>
                <th>Факт</th>
                <th>Факт %</th>
                <th>{'>>%'}</th>
                <th>Осталось</th>
                <th>Начислено</th>
                <th>Пр. %</th>
                <th>Проекция</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((row, i) => (
                <tr key={i} style={{ fontSize: 13 }}>
                  <td>{cell(row.name)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.plan)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.fact)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.stage)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.next_stage)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.remaining)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.accrued)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.proj_pct)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.projection)}</td>
                </tr>
              ))}
              {totalRow && (
                <tr style={{ fontWeight: 600, background: '#f3f4f6' }}>
                  <td>{cell(totalRow.name)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.plan)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.fact)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.stage)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.next_stage)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.remaining)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.accrued)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.proj_pct)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.projection)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {reports.length > 1 && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
            Всего отчётов: {reports.length}. Показан последний.
          </div>
        )}
      </div>
    </div>
  );
}
