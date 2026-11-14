import type { Timestamp, DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import type { Client } from '@/types';

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
