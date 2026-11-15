import type { Timestamp, DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import type { Client } from '@/types';

/**
 * Приводит ФИО к краткому виду «Фамилия И.О.» (например, «Прусакова Ж.Е.»).
 * Сокращение применяется только для формы «ИП»; для остальных форм
 * (например, ООО) возвращается исходное имя полностью.
 */
export function formatClientName(name: string, company?: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) return name;

  const normalizedCompany = (company ?? '').toLowerCase().replace(/\./g, '').trim();
  const isIp =
    normalizedCompany === 'ип' ||
    normalizedCompany.startsWith('ип ') ||
    normalizedCompany.startsWith('индивидуальный предприниматель');

  if (!isIp) return trimmedName;

  const parts = trimmedName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return trimmedName;

  // Имя уже сокращено вручную, например «Прусакова Ж.Е.» или «Прусакова.Ж.Е.».
  if (parts.length === 1 && parts[0].includes('.')) {
    return parts[0].replace(/^([^.\s]+)\./, '$1 ');
  }

  const surname = parts[0].replace(/\.+$/, '');
  const initials = parts
    .slice(1)
    .flatMap((part) =>
      part
        .replace(/\./g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => `${token[0].toUpperCase()}.`),
    );

  return initials.length > 0 ? `${surname} ${initials.join('')}` : surname;
}

/**
 * Приводит режим работы к виду «10:00 - 21:00».
 * Понимает «10:00-21:00», «10.00 - 21.00», «9:00 — 18:00» и т. п.
 * Если распознать интервал не удалось, возвращает значение без изменений.
 */
export function formatWorkingHours(value?: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';

  const match = trimmed.match(/^(\d{1,2})\s*[:.]\s*(\d{2})\s*[-–—]\s*(\d{1,2})\s*[:.]\s*(\d{2})$/);
  if (!match) return trimmed;

  const [, h1, m1, h2, m2] = match;
  const pad = (part: string) => part.padStart(2, '0');
  return `${pad(h1)}:${m1} - ${pad(h2)}:${m2}`;
}

/**
 * Приводит адрес к виду «Город, улица дом».
 * Поддерживает старый формат с точкой: «Ухта. Заводская 6» → «Ухта, Заводская 6».
 */
export function normalizeAddress(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  const parts = trimmed
    .split(/[,.]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const [city, ...rest] = parts;
    return `${city}, ${rest.join(' ')}`;
  }
  return trimmed;
}

/**
 * Адрес для колонки «Адрес» на странице маршрута: только часть после запятой.
 * Пример: «Ухта, Заводская 6» → «Заводская 6». Если запятой нет — возвращает адрес как есть.
 */
export function formatClientAddress(address?: string): string {
  const normalized = normalizeAddress(address ?? '');
  if (!normalized) return '';

  const commaIndex = normalized.indexOf(',');
  if (commaIndex === -1) return normalized;

  const rest = normalized.slice(commaIndex + 1).trim();
  return rest || normalized;
}

/**
 * Форматирует дату/время в вид «13.11.26 11:05» (дд.ММ.гг чч:мм, локальное время).
 * Пустое значение возвращает пустую строку, невалидное — исходное значение.
 */
export function formatClientDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = pad(date.getFullYear() % 100);
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

export function toIsoString(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      return (value as Timestamp).toDate().toISOString();
    } catch {
      return '';
    }
  }
  return '';
}

/** Общий маппинг документа Firestore клиента в типизированный Client. Используется на страницах и в виджетах. */
export function mapClientDoc(snap: QueryDocumentSnapshot<DocumentData>): Client | null {
  try {
    const data = snap.data() as unknown as Client & { ownerUid?: unknown; createdAt?: unknown; updatedAt?: unknown };
    if (typeof data.name !== 'string' || !data.name.trim()) return null;
    if (typeof data.ownerUid !== 'string' || !data.ownerUid) return null;
    return {
      id: snap.id,
      name: data.name.trim(),
      email: typeof data.email === 'string' ? data.email.trim() : '',
      phone: typeof data.phone === 'string' && data.phone.trim() ? data.phone.trim() : undefined,
      company: typeof data.company === 'string' && data.company.trim() ? data.company.trim() : undefined,
      address: typeof data.address === 'string' && data.address.trim() ? normalizeAddress(data.address) : undefined,
      city: typeof data.city === 'string' && data.city.trim() ? data.city.trim() : undefined,
      street: typeof data.street === 'string' && data.street.trim() ? data.street.trim() : undefined,
      day: typeof data.day === 'string' && data.day.trim() ? data.day.trim() : undefined,
      mode: typeof data.mode === 'string' && data.mode.trim() ? data.mode.trim() : undefined,
      manager: typeof data.manager === 'string' && data.manager.trim() ? data.manager.trim() : undefined,
      notes: typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : undefined,
      active: typeof data.active === 'boolean' ? data.active : true,
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined,
      clientCode: typeof data.clientCode === 'string' && data.clientCode.trim()
        ? data.clientCode.trim().toUpperCase()
        : undefined,
      orders: typeof data.orders === 'string' && data.orders.trim() ? data.orders.trim() : undefined,
      grade: (data.grade === 'Gold' || data.grade === 'Silver' || data.grade === 'Bronze') ? data.grade : undefined,
      createdAt: toIsoString(data.createdAt),
      updatedAt: toIsoString(data.updatedAt),
      ownerUid: data.ownerUid,
    };
  } catch {
    return null;
  }
}
