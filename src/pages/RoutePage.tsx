import { useEffect, useMemo, useRef, useState } from 'react';
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
import { DialogCloseButton } from '@/components/DialogCloseButton';
import { EmptyState } from '@/components/EmptyState';
import { formatClientAddress, formatClientName, mapClientDoc } from '@/lib/clientData';
import type { Client } from '@/types';

/** Дни, для которых на странице маршрута выводятся блоки. */
const WEEK_DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'] as const;

type WeekDay = (typeof WEEK_DAYS)[number];

/** Номер дня недели в JS (0 — воскресенье) для каждого дня маршрута. */
const WEEK_DAY_INDEX: Record<WeekDay, number> = {
  Понедельник: 1,
  Вторник: 2,
  Среда: 3,
  Четверг: 4,
  Пятница: 5,
};

/** Ближайшая дата для дня недели: сегодня или следующая по календарю. */
function getNearestDate(day: WeekDay, from: Date = new Date()): Date {
  const diff = (WEEK_DAY_INDEX[day] - from.getDay() + 7) % 7;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + diff);
}

/** Форматирует дату как ДД.ММ.ГГ. */
function formatShortDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

/** Статусы пункта чек-листа (в сохранённом плане). */
type ChecklistStatus = 'planned' | 'in_progress' | 'done';

/** Статус в режиме редактирования: дополнительно «Удалить». */
type DraftChecklistStatus = ChecklistStatus | 'delete';

/** Пункт чек-листа перед визитом. */
interface ChecklistItem {
  id: string;
  text: string;
  status: ChecklistStatus;
}

/** Черновик пункта: строки со статусом «Удалить» убираются при сохранении. */
interface DraftChecklistItem {
  id: string;
  text: string;
  status: DraftChecklistStatus;
}

/** План перед визитом в точку: чек-лист задач. */
interface VisitPlan {
  items: ChecklistItem[];
}

const STATUS_LABELS: Record<ChecklistStatus, string> = {
  planned: 'Запланировано',
  in_progress: 'В процессе',
  done: 'Выполнено',
};

const PLAN_STORAGE_PREFIX = 'zoo-route-plans:';

/** Уникальный id пункта чек-листа. */
function createChecklistId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // crypto.randomUUID может быть недоступен в старых браузерах
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Создаёт пустой черновик пункта чек-листа. */
function createDraftItem(): DraftChecklistItem {
  return { id: createChecklistId(), text: '', status: 'planned' };
}

/** Приводит статус из старого свободного поля к одному из известных. */
function normalizeLegacyStatus(value: string): ChecklistStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'выполнено' || normalized === 'done') return 'done';
  if (normalized === 'в процессе' || normalized === 'in_progress') return 'in_progress';
  return 'planned';
}

/** Поддерживает новый формат { items } и старый { planning, status }. */
function normalizePlan(value: unknown): VisitPlan {
  if (!value || typeof value !== 'object') return { items: [] };
  const raw = value as Record<string, unknown>;

  if (Array.isArray(raw.items)) {
    const items = raw.items
      .map((entry): ChecklistItem | null => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) return null;
        const status: ChecklistStatus =
          item.status === 'done' || item.status === 'in_progress' ? item.status : 'planned';
        return {
          id: typeof item.id === 'string' && item.id ? item.id : createChecklistId(),
          text,
          status,
        };
      })
      .filter((item): item is ChecklistItem => item !== null);
    return { items };
  }

  // Совместимость со старым форматом: одна строка «Планирование» + «Статус».
  const planning = typeof raw.planning === 'string' ? raw.planning.trim() : '';
  const legacyStatus = typeof raw.status === 'string' ? raw.status.trim() : '';
  if (!planning && !legacyStatus) return { items: [] };

  return {
    items: [
      {
        id: createChecklistId(),
        text: planning || legacyStatus,
        status: normalizeLegacyStatus(legacyStatus),
      },
    ],
  };
}

function loadPlans(storageKey: string | null): Record<string, VisitPlan> {
  if (!storageKey) return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const normalized: Record<string, VisitPlan> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([clientId, value]) => {
      const plan = normalizePlan(value);
      if (plan.items.length > 0) normalized[clientId] = plan;
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

const ORDER_STORAGE_PREFIX = 'zoo-route-order:';

/** Порядок клиентов внутри дня: ключ — день недели, значение — id клиентов. */
type DayOrders = Record<string, string[]>;

function loadOrders(storageKey: string | null): DayOrders {
  if (!storageKey) return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const normalized: DayOrders = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([day, value]) => {
      if (Array.isArray(value)) {
        normalized[day] = value.filter((id): id is string => typeof id === 'string');
      }
    });
    return normalized;
  } catch {
    return {};
  }
}

function persistOrders(storageKey: string | null, orders: DayOrders) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(orders));
  } catch {
    // Игнорируем ошибки хранилища (приватный режим, переполнение квоты).
  }
}

interface DayRouteCardProps {
  day: WeekDay;
  dateLabel: string;
  clients: Client[];
  visited: Record<string, boolean>;
  sorting: boolean;
  onToggleVisited: (day: WeekDay, clientId: string) => void;
  onResetVisited: (day: WeekDay) => void;
  onOpenPlan: (client: Client) => void;
  onToggleSorting: (day: WeekDay) => void;
  onMoveClient: (day: WeekDay, clientId: string, direction: -1 | 1) => void;
}

/**
 * Однотипный блок маршрута на день: заголовок + таблица клиентов.
 * Колонка «№» нумеруется по порядку внутри дня, начиная с 1.
 * В режиме сортировки клиентов можно менять местами стрелками, при этом
 * нумерация остаётся сквозной и последовательной.
 * Блоки без клиентов не рендерятся (см. RoutePage).
 */
function DayRouteCard({
  day,
  dateLabel,
  clients,
  visited,
  sorting,
  onToggleVisited,
  onResetVisited,
  onOpenPlan,
  onToggleSorting,
  onMoveClient,
}: DayRouteCardProps) {
  const hasVisited = Object.keys(visited).some((key) => key.startsWith(`${day}:`));

  return (
    <section className="card route-day-card">
      <div className="route-day-header">
        <h3 className="route-day-title">
          {day}
          <span className="route-day-date">{dateLabel}</span>
        </h3>
        <div className="route-day-actions">
          <button
            type="button"
            className={`btn btn-outline btn-sm sort-btn${sorting ? ' sort-btn--active' : ''}`}
            onClick={() => onToggleSorting(day)}
            aria-pressed={sorting}
            title={sorting ? 'Завершить сортировку' : 'Изменить порядок клиентов'}
            aria-label={sorting ? 'Завершить сортировку' : 'Изменить порядок клиентов'}
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
              <path d="M8 20V4M5 7l3-3 3 3" />
              <path d="M16 4v16M13 17l3 3 3-3" />
            </svg>
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm sort-btn"
            onClick={() => onResetVisited(day)}
            disabled={!hasVisited}
          >
            Сброс
          </button>
        </div>
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
              {sorting && <th className="route-col-order">Порядок</th>}
            </tr>
          </thead>
          <tbody>
            {clients.map((client, index) => {
              const visitKey = `${day}:${client.id}`;
              return (
                <tr
                  key={client.id}
                  className={sorting ? 'route-row-sorting' : 'route-row-clickable'}
                  tabIndex={sorting ? undefined : 0}
                  onClick={sorting ? undefined : () => onOpenPlan(client)}
                  onKeyDown={
                    sorting
                      ? undefined
                      : (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onOpenPlan(client);
                        }
                      }
                  }
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
                  {sorting && (
                    <td className="route-col-order">
                      <div className="route-move-buttons">
                        <button
                          type="button"
                          className="route-move-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onMoveClient(day, client.id, -1);
                          }}
                          disabled={index === 0}
                          title="Переместить выше"
                          aria-label={`Переместить выше: ${client.name}`}
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
                            <path d="m18 15-6-6-6 6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="route-move-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onMoveClient(day, client.id, 1);
                          }}
                          disabled={index === clients.length - 1}
                          title="Переместить ниже"
                          aria-label={`Переместить ниже: ${client.name}`}
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
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  )}
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
  // Пользовательский порядок клиентов внутри дня недели.
  const orderStorageKey = user ? `${ORDER_STORAGE_PREFIX}${user.uid}` : null;
  const [orders, setOrders] = useState<DayOrders>(() => loadOrders(orderStorageKey));
  // День, для которого включён режим изменения порядка клиентов.
  const [sortingDay, setSortingDay] = useState<WeekDay | null>(null);
  const [planClient, setPlanClient] = useState<Client | null>(null);
  const [planEditing, setPlanEditing] = useState(false);
  const [planDraft, setPlanDraft] = useState<DraftChecklistItem[]>([]);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const checklistInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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

  // При смене пользователя подгружаем сохранённый порядок клиентов.
  useEffect(() => {
    setOrders(loadOrders(orderStorageKey));
  }, [orderStorageKey]);

  const openPlan = (client: Client) => {
    setPlanClient(client);
    setPlanEditing(false);
    setPlanDraft((plans[client.id]?.items ?? []).map((item) => ({ ...item })));
  };

  const closePlan = () => {
    setPlanClient(null);
    setPlanEditing(false);
    setPlanDraft([]);
  };

  const startPlanEdit = () => {
    if (!planClient) return;
    const existing = plans[planClient.id]?.items ?? [];
    const draft = existing.length > 0 ? existing.map((item) => ({ ...item })) : [createDraftItem()];
    setPlanDraft(draft);
    setPlanEditing(true);
    if (existing.length === 0) setFocusItemId(draft[0].id);
  };

  // После добавления строки переводим фокус в её поле ввода.
  useEffect(() => {
    if (!focusItemId) return;
    const input = checklistInputRefs.current[focusItemId];
    if (input) {
      input.focus();
      input.scrollIntoView({ block: 'nearest' });
    }
    setFocusItemId(null);
  }, [focusItemId, planDraft]);

  const updateDraftItem = (
    id: string,
    patch: Partial<Pick<DraftChecklistItem, 'text' | 'status'>>,
  ) => {
    setPlanDraft((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  // Enter в строке добавляет новый пункт сразу под текущим.
  const addDraftItemAfter = (index: number) => {
    const item = createDraftItem();
    setPlanDraft((prev) => {
      const next = [...prev];
      next.splice(Math.max(index + 1, 0), 0, item);
      return next;
    });
    setFocusItemId(item.id);
  };

  const savePlan = () => {
    if (!planClient) return;
    // Строки со статусом «Удалить» и пустые строки не сохраняем.
    const items = planDraft
      .filter((item) => item.status !== 'delete')
      .map((item) => ({
        id: item.id,
        text: item.text.trim(),
        status: item.status as ChecklistStatus,
      }))
      .filter((item) => item.text.length > 0);

    const next = { ...plans };
    if (items.length === 0) {
      delete next[planClient.id];
    } else {
      next[planClient.id] = { items };
    }

    setPlans(next);
    persistPlans(storageKey, next);
    setPlanDraft(items.map((item) => ({ ...item })));
    setPlanEditing(false);
  };

  const clearPlan = () => {
    if (!planClient) return;
    const next = { ...plans };
    delete next[planClient.id];
    setPlans(next);
    persistPlans(storageKey, next);
    setPlanDraft([]);
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

    // Применяем сохранённый пользователем порядок; новых клиентов
    // добавляем в конец списка.
    WEEK_DAYS.forEach((day) => {
      const order = orders[day];
      if (!order || order.length === 0) return;

      const positions = new Map(order.map((id, index) => [id, index]));
      grouped[day].sort((a, b) => {
        const posA = positions.get(a.id);
        const posB = positions.get(b.id);
        if (posA === undefined && posB === undefined) return 0;
        if (posA === undefined) return 1;
        if (posB === undefined) return -1;
        return posA - posB;
      });
    });

    return grouped;
  }, [clients, orders]);

  // Показываем только дни, в которых есть клиенты.
  const daysWithClients = WEEK_DAYS.filter((day) => clientsByDay[day].length > 0);

  // Включает/выключает режим изменения порядка клиентов выбранного дня.
  const toggleSorting = (day: WeekDay) => {
    setSortingDay((prev) => (prev === day ? null : day));
  };

  // Меняет клиента местами с соседом сверху (-1) или снизу (1).
  const moveClient = (day: WeekDay, clientId: string, direction: -1 | 1) => {
    const ids = clientsByDay[day].map((client) => client.id);
    const index = ids.indexOf(clientId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;

    [ids[index], ids[target]] = [ids[target], ids[index]];
    const next: DayOrders = { ...orders, [day]: ids };
    setOrders(next);
    persistOrders(orderStorageKey, next);
  };

  const currentItems = planClient ? plans[planClient.id]?.items ?? [] : [];
  const doneCount = currentItems.filter((item) => item.status === 'done').length;
  const hasPlanData =
    currentItems.length > 0 || planDraft.some((item) => item.text.trim().length > 0);

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
            dateLabel={formatShortDate(getNearestDate(day))}
            clients={clientsByDay[day]}
            visited={visited}
            sorting={sortingDay === day}
            onToggleVisited={toggleVisited}
            onResetVisited={resetVisited}
            onOpenPlan={openPlan}
            onToggleSorting={toggleSorting}
            onMoveClient={moveClient}
          />
        ))
      )}

      {planClient && (
        <div className="dialog-overlay" onClick={closePlan}>
          <div
            className="dialog route-plan-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <DialogCloseButton onClick={closePlan} label="Закрыть окно планирования" />
            <div className="dialog-title">{planClient.name}</div>
            <p className="route-plan-subtitle">{planClient.address || 'Адрес не указан'}</p>

            <div className="route-plan-section">
              <div className="route-plan-section-head">
                <span className="form-label">Планирование задач</span>
                {planEditing ? (
                  <span className="route-plan-hint">Enter — новая строка</span>
                ) : (
                  currentItems.length > 0 && (
                    <span className="route-plan-progress">
                      Выполнено {doneCount} из {currentItems.length}
                    </span>
                  )
                )}
              </div>

              {planEditing ? (
                <>
                  <div className="route-checklist route-checklist--edit">
                    {planDraft.map((item, index) => (
                      <div
                        key={item.id}
                        className={`route-checklist-row${item.status === 'delete' ? ' route-checklist-row--deleted' : ''}`}
                      >
                        <span className="route-checklist-mark" aria-hidden="true">
                          {item.status === 'done' ? '✓' : item.status === 'in_progress' ? '◐' : '○'}
                        </span>
                        <input
                          ref={(element) => {
                            checklistInputRefs.current[item.id] = element;
                          }}
                          className="form-input route-checklist-input"
                          value={item.text}
                          placeholder={index === 0 ? 'Что нужно сделать перед визитом' : 'Новая строка'}
                          onChange={(event) => updateDraftItem(item.id, { text: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addDraftItemAfter(index);
                            }
                          }}
                          aria-label={`Пункт ${index + 1}`}
                        />
                        <select
                          className="form-input route-checklist-status"
                          value={item.status}
                          onChange={(event) =>
                            updateDraftItem(item.id, {
                              status: event.target.value as DraftChecklistStatus,
                            })
                          }
                          aria-label={`Статус пункта ${index + 1}`}
                        >
                          <option value="planned">Запланировано</option>
                          <option value="in_progress">В процессе</option>
                          <option value="done">Выполнено</option>
                          <option value="delete">Удалить</option>
                        </select>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm route-checklist-add"
                    onClick={() => addDraftItemAfter(planDraft.length - 1)}
                  >
                    + Добавить строку
                  </button>
                  <p className="route-plan-hint">
                    Строки со статусом «Удалить» исчезнут после сохранения.
                  </p>
                </>
              ) : currentItems.length === 0 ? (
                <div className="route-plan-empty">Пока нет задач</div>
              ) : (
                <ul className="route-checklist">
                  {currentItems.map((item) => (
                    <li
                      key={item.id}
                      className={`route-checklist-item route-checklist-item--${item.status}`}
                    >
                      <span className="route-checklist-mark" aria-hidden="true">
                        {item.status === 'done' ? '✓' : item.status === 'in_progress' ? '◐' : '○'}
                      </span>
                      <span className="route-checklist-text">{item.text}</span>
                      <span className={`route-checklist-badge route-checklist-badge--${item.status}`}>
                        {STATUS_LABELS[item.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
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
