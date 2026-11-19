import { useEffect, useMemo, useState } from 'react';
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
  /** Строка, открытая в окне подробностей. null — окно закрыто. */
  const [selectedRow, setSelectedRow] = useState<KpiRow | null>(null);

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



  /** Средний процент по направлениям — для итоговой строки. */
  const averagePercent = useMemo(() => {
    const num = (value: string | number | null | undefined): number | null => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value !== 'string') return null;
      const parsed = Number.parseFloat(
        value.replace(/\s|\u00a0/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''),
      );
      return Number.isFinite(parsed) ? parsed : null;
    };
    const lines = reports[0]?.result?.lines ?? [];
    const values = lines
      .filter((row) => row.name !== 'ИТОГО')
      .map((row) => {
        // Для среднего в «Итого» процент ограничен сотней: направление,
        // перевыполнившее план втрое, не должно тянуть средний показатель
        // выше 100%. В самой строке направления процент остаётся фактическим.
        const capped = (value: number) => Math.min(value, 100);
        const reported = num(row.stage);
        if (reported !== null && reported > 0) return capped(reported);
        const plan = num(row.plan);
        const fact = num(row.fact);
        if (plan !== null && plan > 0 && fact !== null) return capped((fact / plan) * 100);
        return null;
      })
      .filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [reports]);

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

  /** Число из значения отчёта: «2 850 000», «40%» → число. null, если не число. */
  const toNumber = (value: string | number | null | undefined): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s|\u00a0/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  /**
   * Процент выполнения плана по строке.
   *
   * Поле stage для направления «Общий» 1С оставляет нулевым при непустом
   * факте, поэтому приоритет: значение отчёта, если оно ненулевое, иначе
   * расчёт факт ÷ план.
   */
  const percentText = (row: KpiRow): string => {
    const reported = toNumber(row.stage);
    if (reported !== null && reported > 0) return `${reported}%`;
    const plan = toNumber(row.plan);
    const fact = toNumber(row.fact);
    if (plan !== null && plan > 0 && fact !== null) return `${Math.round((fact / plan) * 100)}%`;
    return '—';
  };


  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="card">
        <h2 className="card-title">KPI задачи</h2>

        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            fontSize: 13,
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            {latest.result.header.split(' Средняя отгрузка:')[0]}
          </div>
          {latest.result.header.includes('Средняя отгрузка:') && (
            <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>
              Средняя отгрузка: {latest.result.header.split('Средняя отгрузка:')[1].trim()}
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Направление</th>
                <th>План</th>
                <th>Факт</th>
                <th>Факт %</th>
                <th>Начислено</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((row, i) => (
                <tr
                  key={i}
                  style={{ fontSize: 13, cursor: 'pointer' }}
                  onClick={() => setSelectedRow(row)}
                  title="Показать подробности по направлению"
                >
                  <td>{cell(row.name)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.plan)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.fact)}</td>
                  <td style={{ textAlign: 'center' }}>{percentText(row)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(row.accrued)}</td>
                </tr>
              ))}
              {totalRow && (
                <tr
                  className="table-summary"
                  style={{ fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => setSelectedRow(totalRow)}
                  title="Показать подробности по итогу"
                >
                  <td>{cell(totalRow.name)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.plan)}</td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.fact)}</td>
                  <td style={{ textAlign: 'center' }}>
                    {averagePercent === null ? '—' : `${Math.round(averagePercent)}%`}
                  </td>
                  <td style={{ textAlign: 'center' }}>{cell(totalRow.accrued)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
          Последний отчёт: {fmtDate(latest.createdAt)}
        </div>
      </div>

      {selectedRow && (
        <div className="dialog-overlay" onClick={() => setSelectedRow(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <h3 style={{ marginTop: 0 }}>{cell(selectedRow.name)}</h3>

            <table className="table" style={{ marginTop: 8 }}>
              <tbody>
                {[
                  ['План', cell(selectedRow.plan)],
                  ['Факт', cell(selectedRow.fact)],
                  ['Факт, %', percentText(selectedRow)],
                  ['Следующая ступень', cell(selectedRow.next_stage)],
                  ['Осталось до ступени', cell(selectedRow.remaining)],
                  ['Начислено', cell(selectedRow.accrued)],
                  ['Проекция, %', cell(selectedRow.proj_pct)],
                  ['Проекция начисления', cell(selectedRow.projection)],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <th
                      scope="row"
                      style={{
                        textAlign: 'left',
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </th>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Отчёт от {fmtDate(latest.createdAt)}
            </div>

            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button type="button" className="btn btn-outline" onClick={() => setSelectedRow(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
