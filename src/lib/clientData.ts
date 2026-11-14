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
 * Сокращает адрес для отображения в маршруте: оставляет часть после первой запятой.
 * Пример: «Ухта, Заводская» → «Заводская». Если запятой нет — возвращает адрес как есть.
 */
export function formatClientAddress(address?: string): string {
  const trimmed = (address ?? '').trim();
  if (!trimmed) return '';

  const commaIndex = trimmed.indexOf(',');
  if (commaIndex === -1) return trimmed;

  const rest = trimmed.slice(commaIndex + 1).trim();
  return rest || trimmed;
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
    if (typeof data.email !== 'string' || !data.email.trim()) return null;
    if (typeof data.ownerUid !== 'string' || !data.ownerUid) return null;
    return {
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
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined,
      grade: (data.grade === 'Gold' || data.grade === 'Silver' || data.grade === 'Bronze') ? data.grade : undefined,
      createdAt: toIsoString(data.createdAt),
      updatedAt: toIsoString(data.updatedAt),
      ownerUid: data.ownerUid,
    };
  } catch {
    return null;
  }
}
