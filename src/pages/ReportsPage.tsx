import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { ProgressRing } from '@/components/ProgressRing';
import { mapClientDoc } from '@/lib/clientData';
import type { Client } from '@/types';

/** Число или строка — 1С отдаёт суммы то числом, то текстом. */
type CellValue = string | number;

type KpiRow = {
  name: string;
  plan: CellValue;
  fact: CellValue;
  accrued: CellValue;
};

/** Приводит значение из отчёта к числу; нечисловое считаем нулём. */
function toNumber(value: CellValue | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  // «1 234 567,89» — пробелы-разделители разрядов и запятая как десятичная.
  const normalized = value.replace(/\s|\u00a0/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

type KpiTotals = { plan: number; fact: number; accrued: number; projection: number | null };

/**
 * Показатели KPI для верхней плашки.
 *
 * Строка «ИТОГО» в отчёте НЕ содержит плана и факта: 1С даёт общий оборот
 * только начислением, поэтому в ней плана и факта нет (там «—»), зато есть
 * «Начислено» и «Проекция». План и факт берём из направления «Общий» —
 * это общий оборот по всем группам товаров.
 */
function readKpiTotals(snap: QueryDocumentSnapshot<DocumentData>): KpiTotals | null {
  const data = snap.data();
  const lines = data?.result?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return null;

  const overall = lines.find(
    (row: KpiRow) => typeof row?.name === 'string' && row.name.trim().toLowerCase() === 'общий',
  );
  const total = lines.find(
    (row: KpiRow) => typeof row?.name === 'string' && row.name.trim().toUpperCase() === 'ИТОГО',
  );

  if (!overall && !total) return null;

  const projectionText = total?.projection;
  const projection =
    typeof projectionText === 'string' && projectionText.trim() === '—'
      ? null
      : toNumber(projectionText);

  return {
    plan: toNumber(overall?.plan),
    fact: toNumber(overall?.fact),
    accrued: toNumber(total?.accrued),
    projection,
  };
}

export function ReportsPage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [kpi, setKpi] = useState<KpiTotals | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

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

  // Последний отчёт KPI владельца. Читается тем же запросом, что и на странице
  // «KPI задачи», поэтому правило Firestore (ownerUid == email токена) подходит.
  useEffect(() => {
    if (!user) {
      setKpi(null);
      setKpiLoading(false);
      return;
    }
    if (!isFirebaseConfigured() || !db) {
      setKpiLoading(false);
      return;
    }
    setKpiLoading(true);
    const q = query(
      collection(db, 'kpi_reports'),
      where('ownerUid', '==', user.email),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const first = snapshot.docs[0] ?? null;
        setKpi(first ? readKpiTotals(first) : null);
        setKpiLoading(false);
      },
      () => {
        // Ошибка чтения не должна скрывать блок АКБ: KPI просто останется пустым.
        setKpi(null);
        setKpiLoading(false);
      },
    );
    return () => unsub();
  }, [user]);

  const activeCount = useMemo(() => clients.filter((c) => c.active).length, [clients]);
  const activeShare = useMemo(() => (clients.length > 0 ? activeCount / clients.length : 0), [clients, activeCount]);
  const kpiPercent = useMemo(
    () => (kpi && kpi.plan > 0 ? kpi.fact / kpi.plan : null),
    [kpi],
  );
  const formatNumber = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

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
      {!(clientsLoading && kpiLoading) && (
        <>
          {/* Блок KPI: последний отчёт из kpi_reports. */}
          <div style={{ fontSize: 16, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text)', marginBottom: 8 }}>KPI</div>
          <div className="card" style={{ marginTop: 12, marginBottom: 12, padding: 12 }}>
            <div className="stats-row">
              <div className="stat-tile">
                <div className="stat-label">План (общий)</div>
                <div className="stat-value">{kpi ? formatNumber(kpi.plan) : '—'}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Факт (общий)</div>
                <div className="stat-value stat-value--success">{kpi ? formatNumber(kpi.fact) : '—'}</div>
              </div>
              <div className="stat-tile">
                <ProgressRing percent={kpiPercent} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 8, textAlign: 'center' }}>
              {kpiLoading
                ? 'Загрузка отчёта KPI…'
                : kpi
                  ? `Начислено ${kpi.accrued ? formatNumber(kpi.accrued) : '—'} ₽ · Проекция ${
                      kpi.projection === null ? '—' : `${formatNumber(kpi.projection)} ₽`
                    }`
                  : 'Данные KPI появятся после запуска процесса «KPI Продажи».'}
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