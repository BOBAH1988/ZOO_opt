import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { EmptyState } from '@/components/EmptyState';
import { formatClientAddress, formatClientName, mapClientDoc } from '@/lib/clientData';
import type { Client } from '@/types';

/** Дни, для которых на странице маршрута выводятся блоки. */
const WEEK_DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'] as const;

type WeekDay = (typeof WEEK_DAYS)[number];

/** План перед визитом в точку: что сделать и текущий статус. */
interface VisitPlan {
  planning: string;
  status: string;
}

const EMPTY_PLAN: VisitPlan = { planning: '', status: '' };

const PLAN_STORAGE_PREFIX = 'zoo-route-plans:';

function loadPlans(storageKey: string | null): Record<string, VisitPlan> {
  if (!storageKey) return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const normalized: Record<string, VisitPlan> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([clientId, value]) => {
      if (value && typeof value === 'object') {
        const plan = value as Partial<VisitPlan>;
        normalized[clientId] = {
          planning: typeof plan.planning === 'string' ? plan.planning : '',
          status: typeof plan.status === 'string' ? plan.status : '',
        };
      }
    });
    return normalized;
  } catch {
    return {};
  }
}

function persistPlans(storageKey: string | null, plans: Record<string, VisitPlan>) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(plans));
  } catch {
    // Игнорируем ошибки хранилища (приватный режим, переполнение квоты).
  }
}

interface DayRouteCardProps {
  day: WeekDay;
  clients: Client[];
  visited: Record<string, boolean>;
  onToggleVisited: (day: WeekDay, clientId: string) => void;
  onResetVisited: (day: WeekDay) => void;
  onOpenPlan: (client: Client) => void;
}

/**
 * Однотипный блок маршрута на день: заголовок + таблица клиентов.
 * Колонка «№» нумеруется по порядку внутри дня, начиная с 1.
 * Блоки без клиентов не рендерятся (см. RoutePage).
 */
function DayRouteCard({
  day,
  clients,
  visited,
  onToggleVisited,
  onResetVisited,
  onOpenPlan,
}: DayRouteCardProps) {
  const hasVisited = Object.keys(visited).some((key) => key.startsWith(`${day}:`));

  return (
    <section className="card route-day-card">
      <div className="route-day-header">
        <h3 className="route-day-title">{day}</h3>
        <button
          type="button"
          className="btn btn-outline btn-sm route-reset-btn"
          onClick={() => onResetVisited(day)}
          disabled={!hasVisited}
        >
          Сброс
        </button>
      </div>
      <div className="route-table-wrapper">
        <table className="table route-table">
          <thead>
            <tr>
              <th className="route-col-check" aria-label="Отметка посещения">
                <svg
                  className="route-check-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </th>
              <th className="route-col-number">№</th>
              <th className="route-col-client">Клиент</th>
              <th className="route-col-address">Адрес</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client, index) => {
              const visitKey = `${day}:${client.id}`;
              return (
                <tr
                  key={client.id}
                  className="route-row-clickable"
                  tabIndex={0}
                  onClick={() => onOpenPlan(client)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenPlan(client);
                    }
                  }}
                >
                  <td className="route-col-check">
                    <input
                      type="checkbox"
                      className="route-checkbox"
                      checked={Boolean(visited[visitKey])}
                      onChange={() => onToggleVisited(day, client.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Отметить посещение: ${client.name}`}
                    />
                  </td>
                  <td className="route-col-number">{index + 1}</td>
                  <td className="route-col-client">
                    <strong>{formatClientName(client.name, client.company)}</strong>
                  </td>
                  <td className="route-col-address">
                    {formatClientAddress(client.address) || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RoutePage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Отметки посещения точек: ключ «день:id клиента».
  const [visited, setVisited] = useState<Record<string, boolean>>({});
  // Планы перед визитом: ключ — id клиента.
  const storageKey = user ? `${PLAN_STORAGE_PREFIX}${user.uid}` : null;
  const [plans, setPlans] = useState<Record<string, VisitPlan>>(() =>
    loadPlans(storageKey),
  );
  const [planClient, setPlanClient] = useState<Client | null>(null);
  const [planEditing, setPlanEditing] = useState(false);
  const [planDraft, setPlanDraft] = useState<VisitPlan>(EMPTY_PLAN);

  const toggleVisited = (day: WeekDay, clientId: string) => {
    const key = `${day}:${clientId}`;
    setVisited((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Сбрасывает все отметки посещения выбранного дня.
  const resetVisited = (day: WeekDay) => {
    setVisited((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${day}:`)) delete next[key];
      });
      return next;
    });
  };

  // При смене пользователя подгружаем его сохранённые планы.
  useEffect(() => {
    setPlans(loadPlans(storageKey));
  }, [storageKey]);

  const openPlan = (client: Client) => {
    setPlanClient(client);
    setPlanEditing(false);
    setPlanDraft(plans[client.id] ?? EMPTY_PLAN);
  };

  const closePlan = () => {
    setPlanClient(null);
    setPlanEditing(false);
  };

  const startPlanEdit = () => {
    if (!planClient) return;
    setPlanDraft(plans[planClient.id] ?? EMPTY_PLAN);
    setPlanEditing(true);
  };

  const savePlan = () => {
    if (!planClient) return;
    const nextPlan: VisitPlan = {
      planning: planDraft.planning.trim(),
      status: planDraft.status.trim(),
    };

    const next = { ...plans };
    if (!nextPlan.planning && !nextPlan.status) {
      delete next[planClient.id];
    } else {
      next[planClient.id] = nextPlan;
    }

    setPlans(next);
    persistPlans(storageKey, next);
    setPlanEditing(false);
  };

  const clearPlan = () => {
    if (!planClient) return;
    const next = { ...plans };
    delete next[planClient.id];
    setPlans(next);
    persistPlans(storageKey, next);
    setPlanDraft(EMPTY_PLAN);
    setPlanEditing(false);
  };

  useEffect(() => {
    if (!isFirebaseConfigured() || !db) {
      setError('Firebase не сконфигурирован. Настройте VITE_FIREBASE_* переменные окружения.');
      setLoading(false);
      return;
    }
    if (!user) {
      setClients([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Та же коллекция и фильтр, что и на странице «База клиентов».
    const q = query(
      collection(db, 'clients'),
      where('ownerUid', '==', user.uid),
      orderBy('updatedAt', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Client[] = [];
        snapshot.forEach((snap: QueryDocumentSnapshot<DocumentData>) => {
          const parsed = mapClientDoc(snap);
          if (parsed) list.push(parsed);
        });
        setClients(list);
        setLoading(false);
      },
      (err) => {
        setError(err?.message || 'Ошибка загрузки клиентов');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [user]);

  const clientsByDay = useMemo(() => {
    const grouped: Record<WeekDay, Client[]> = {
      Понедельник: [],
      Вторник: [],
      Среда: [],
      Четверг: [],
      Пятница: [],
    };

    clients.forEach((client) => {
      const day = client.day?.trim();
      if (day && day in grouped) {
        grouped[day as WeekDay].push(client);
      }
    });

    return grouped;
  }, [clients]);

  // Показываем только дни, в которых есть клиенты.
  const daysWithClients = WEEK_DAYS.filter((day) => clientsByDay[day].length > 0);

  const currentPlan = planClient ? plans[planClient.id] ?? EMPTY_PLAN : EMPTY_PLAN;
  const shownPlan = planEditing ? planDraft : currentPlan;
  const hasPlanData = Boolean(
    currentPlan.planning || currentPlan.status || planDraft.planning || planDraft.status,
  );

  return (
    <div>
      <h2 className="page-title">Маршрут</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="card">
          <p style={{ textAlign: 'center', color: '#6b7280', padding: 24 }}>
            Загрузка клиентов…
          </p>
        </div>
      ) : daysWithClients.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Маршрут не сформирован"
            description="Нет клиентов с указанным днём посещения. Заполните поле «День посещения» в базе клиентов."
          />
        </div>
      ) : (
        daysWithClients.map((day) => (
          <DayRouteCard
            key={day}
            day={day}
            clients={clientsByDay[day]}
            visited={visited}
            onToggleVisited={toggleVisited}
            onResetVisited={resetVisited}
            onOpenPlan={openPlan}
          />
        ))
      )}

      {planClient && (
        <div className="dialog-overlay" onClick={closePlan}>
          <div
            className="dialog route-plan-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="route-plan-close"
              onClick={closePlan}
              aria-label="Закрыть окно планирования"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="dialog-title">{planClient.name}</div>
            <p className="route-plan-subtitle">{planClient.address || 'Адрес не указан'}</p>

            <div className="route-plan-grid">
              <div className="route-plan-col">
                <label className="form-label" htmlFor="route-plan-planning">
                  Планирование
                </label>
                {planEditing ? (
                  <textarea
                    id="route-plan-planning"
                    className="form-input route-plan-textarea"
                    value={planDraft.planning}
                    onChange={(event) =>
                      setPlanDraft((prev) => ({ ...prev, planning: event.target.value }))
                    }
                    placeholder="Что нужно сделать перед визитом"
                  />
                ) : (
                  <div className="route-plan-value">{shownPlan.planning || '—'}</div>
                )}
              </div>

              <div className="route-plan-col">
                <label className="form-label" htmlFor="route-plan-status">
                  Статус
                </label>
                {planEditing ? (
                  <textarea
                    id="route-plan-status"
                    className="form-input route-plan-textarea"
                    value={planDraft.status}
                    onChange={(event) =>
                      setPlanDraft((prev) => ({ ...prev, status: event.target.value }))
                    }
                    placeholder="Статус"
                  />
                ) : (
                  <div className="route-plan-value">{shownPlan.status || '—'}</div>
                )}
              </div>
            </div>

            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={planEditing ? savePlan : startPlanEdit}
              >
                {planEditing ? 'Сохранить' : 'Редактировать'}
              </button>
              <button
                type="button"
                className="btn btn-outline route-plan-clear"
                onClick={clearPlan}
                disabled={!hasPlanData}
              >
                Очистить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
