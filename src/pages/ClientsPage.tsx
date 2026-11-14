import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { EmptyState } from '@/components/EmptyState';
import { formatClientName, mapClientDoc } from '@/lib/clientData';
import type { Client, NewClientInput } from '@/types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Копирует текст в буфер обмена, с запасным вариантом для небезопасных контекстов. */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

/** Приводит адрес к виду «Город. улица дом». */
export function normalizeAddress(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const parts = trimmed
    .split(/[,.]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const [city, ...rest] = parts;
    return `${city}. ${rest.join(' ')}`;
  }
  return trimmed;
}

/** Формирует текстовое представление карточки клиента для копирования. */
function buildClientCardText(data: NewClientInput): string {
  const rows: Array<[string, string]> = [
    ['Клиент', data.name?.trim() || '—'],
    ['Форма', data.company?.trim() || '—'],
    ['Адрес', data.address?.trim() || '—'],
    ['Почта', data.email?.trim() || '—'],
    ['Телефон', data.phone?.trim() || '—'],
    ['День посещения', data.day?.trim() || '—'],
    ['Режим работы', data.mode?.trim() || '—'],
    ['Управляющий', data.manager?.trim() || '—'],
    ['Примечания', data.notes?.trim() || '—'],
    ['Название', data.title?.trim() || '—'],
    ['Грейд', data.grade || '—'],
    ['Активный', data.active ? 'Да' : 'Нет'],
  ];
  return rows.map(([label, value]) => `${label}: ${value}`).join('\n');
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Кнопка-иконка копирования значения в буфер обмена. */
function CopyButton({ value, title = 'Копировать', className = '' }: { value?: string; title?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(value && value.trim());

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canCopy) return;
    try {
      await copyToClipboard(value as string);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ошибки доступа к буферу обмена игнорируем
    }
  };

  return (
    <button
      type="button"
      className={`copy-btn${copied ? ' copied' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      title={copied ? 'Скопировано' : title}
      aria-label={title}
      disabled={!canCopy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

const GRADE_STARS: Record<'Bronze' | 'Silver' | 'Gold', { count: number; color: string }> = {
  Bronze: { count: 1, color: '#cd7f32' },
  Silver: { count: 2, color: '#9ca3af' },
  Gold: { count: 3, color: '#f59e0b' },
};

/** Звёзды грейда: ☆ — не заполнен, ★ Bronze / ★★ Silver / ★★★ Gold. */
function GradeStars({ grade }: { grade?: Client['grade'] }) {
  if (!grade || !GRADE_STARS[grade]) {
    return (
      <span style={{ color: '#d1d5db', fontSize: 14 }} title="Грейд не заполнен">
        ☆
      </span>
    );
  }
  const { count, color } = GRADE_STARS[grade];
  return (
    <span style={{ color, fontSize: 14, letterSpacing: 1 }} title={`Грейд: ${grade}`}>
      {'★'.repeat(count)}
    </span>
  );
}

export function ClientsPage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [form, setForm] = useState<NewClientInput>({ name: '', email: '', phone: '', company: 'ИП', address: '', day: '', mode: '', manager: '', notes: '', active: true, title: '', grade: 'Gold' });
  const [saving, setSaving] = useState(false);

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

    const q = query(
      collection(db, 'clients'),
      where('ownerUid', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Client[] = [];
        let skipped = 0;
        snapshot.forEach((snap: QueryDocumentSnapshot<DocumentData>) => {
          const parsed = mapClientDoc(snap);
          if (parsed) list.push(parsed);
          else skipped += 1;
        });
        setClients(list);
        setSkippedCount(skipped);
        setLoading(false);
      },
      (err) => {
        setError(err?.message || 'Ошибка загрузки клиентов');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [user]);

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    (c.company && c.company.toLowerCase().includes(search.toLowerCase())) ||
    (c.address && c.address.toLowerCase().includes(search.toLowerCase())) ||
    (c.manager && c.manager.toLowerCase().includes(search.toLowerCase()))
  );

  const resetForm = () => {
    setForm({ name: '', email: '', phone: '', company: 'ИП', address: '', day: '', mode: '', manager: '', notes: '', active: true, title: '', grade: 'Gold' });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;
    const email = form.email.trim();
    if (!EMAIL_PATTERN.test(email)) {
      setError('Почта должна быть в формате name@example.com');
      return;
    }
    const address = normalizeAddress(form.address ?? '');
    setSaving(true);
    setError(null);
    try {
      const data: Record<string, unknown> = {
        name: form.name.trim(),
        email,
        phone: form.phone?.trim() || null,
        company: form.company?.trim() || null,
        address: address || null,
        day: form.day?.trim() || null,
        mode: form.mode?.trim() || null,
        manager: form.manager?.trim() || null,
        notes: form.notes?.trim() || null,
        active: form.active ?? true,
        title: form.title?.trim() || null,
        grade: form.grade ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ownerUid: user.uid,
      };
      Object.keys(data).forEach((key) => data[key] === undefined && delete data[key]);
      await addDoc(collection(db, 'clients'), data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка создания клиента';
      setError(message);
      setSaving(false);
      return;
    }
    setSaving(false);
    resetForm();
    setEditingId(null);
  };

  const handleUpdate = async (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;
    const email = form.email.trim();
    if (!EMAIL_PATTERN.test(email)) {
      setError('Почта должна быть в формате name@example.com');
      return;
    }
    const address = normalizeAddress(form.address ?? '');
    setSaving(true);
    setError(null);
    try {
      const data: Record<string, unknown> = {
        name: form.name.trim(),
        email,
        phone: form.phone?.trim() || null,
        company: form.company?.trim() || null,
        address: address || null,
        day: form.day?.trim() || null,
        mode: form.mode?.trim() || null,
        manager: form.manager?.trim() || null,
        notes: form.notes?.trim() || null,
        active: form.active ?? true,
        title: form.title?.trim() || null,
        grade: form.grade ?? null,
        updatedAt: serverTimestamp(),
      };
      Object.keys(data).forEach((key) => data[key] === undefined && delete data[key]);
      await updateDoc(doc(db, 'clients', id), data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка обновления клиента';
      setError(message);
      setSaving(false);
      return;
    }
    setSaving(false);
    resetForm();
    setEditingId(null);
  };

  const handleDeleteConfirm = (id: string, name: string) => {
    setDeleteTarget({ id, name });
  };

  const handleDelete = async () => {
    if (!deleteTarget || !db) return;
    setSaving(true);
    setError(null);
    try {
      await deleteDoc(doc(db, 'clients', deleteTarget.id));
      setDeleteTarget(null);
      setDeleteConfirmed(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления клиента';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!isFirebaseConfigured() || !db) {
    return (
      <div className="card">
        <h2 className="card-title">База клиентов</h2>
        <div className="alert alert-warning">
          Firebase не сконфигурирован. Задайте переменные окружения VITE_FIREBASE_*
          (apiKey, authDomain, projectId, appId и т.д.) и пересоберите проект.
          Чтение и запись клиентов будут доступны после настройки Firestore и правил безопасности.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">База клиентов</h2>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          placeholder="Поиск по имени, email, компании"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className="btn btn-primary" onClick={() => { resetForm(); setEditingId('new'); }} disabled={!user}>
          + Добавить клиента
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {skippedCount > 0 && (
        <div className="alert alert-warning">
          Пропущено записей с некорректной структурой: {skippedCount}. Проверьте данные в Firestore.
        </div>
      )}

      {loading ? (
        <div className="card">
          <p style={{ textAlign: 'center', color: '#6b7280', padding: 24 }}>Загрузка клиентов…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Клиентов не найдено"
            description={
              search
                ? 'По вашему запросу ничего не найдено.'
                : 'В базе клиентов пока нет записей. Добавьте первого клиента.'
            }
          />
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table
            className="table"
            style={{ width: '100%', borderCollapse: 'collapse' }}
          >
            <thead>
              <tr>
                <th style={{ width: '48px', whiteSpace: 'nowrap' }}>Активный</th>
                <th style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Форма</th>
                <th style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Клиент</th>
                <th style={{ width: '80px', whiteSpace: 'nowrap', textAlign: 'center' }}>Грейд</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id} onClick={() => setViewingClient(client)} style={{ cursor: 'pointer' }}>
                  <td style={{ width: '48px', whiteSpace: 'nowrap', textAlign: 'center' }}>{client.active ? '✅' : '❌'}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.company || '—'}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong>{formatClientName(client.name, client.company)}</strong>
                  </td>
                  <td style={{ width: '80px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <GradeStars grade={client.grade} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingId && (
        <div className="dialog-overlay" onClick={() => { setEditingId(null); resetForm(); }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div className="dialog-title-row">
              <div className="dialog-title">
                {editingId === 'new' ? 'Новый клиент' : 'Редактирование клиента'}
              </div>
              {editingId !== 'new' && (
                <CopyButton
                  value={buildClientCardText(form)}
                  title="Скопировать карточку клиента"
                  className="copy-btn--title"
                />
              )}
            </div>
            <form
              onSubmit={(e) =>
                editingId === 'new' ? handleCreate(e) : handleUpdate(editingId, e)
              }
              style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
            >
              <div className="form-group">
                <label className="form-label">Клиент</label>
                <input className="form-input" required
                  value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Активный</label>
                <select className="form-input"
                  value={form.active ? 'active' : 'inactive'}
                  onChange={(e) => setForm({ ...form, active: e.target.value === 'active' })}>
                  <option value="active">✅ Активный</option>
                  <option value="inactive">❌ Не активный</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Форма</label>
                <select className="form-input"
                  value={form.company || ''}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}>
                  <option value="">—</option>
                  <option value="ИП">ИП</option>
                  <option value="ООО">ООО</option>
                  {form.company && form.company !== 'ИП' && form.company !== 'ООО' && (
                    <option value={form.company}>{form.company}</option>
                  )}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Адрес</label>
                <input className="form-input" placeholder="Город. улица дом"
                  value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                <div className="form-hint">Формат: Город. улица дом</div>
              </div>
              <div className="form-group">
                <label className="form-label">Почта</label>
                <div className="input-with-action">
                  <input className="form-input" type="email" required placeholder="name@example.com"
                    value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  <CopyButton value={form.email} title="Скопировать почту" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">День посещения</label>
                <select className="form-input"
                  value={form.day ?? ''}
                  onChange={(e) => setForm({ ...form, day: e.target.value })}>
                  <option value="">—</option>
                  <option value="Понедельник">Понедельник</option>
                  <option value="Вторник">Вторник</option>
                  <option value="Среда">Среда</option>
                  <option value="Четверг">Четверг</option>
                  <option value="Пятница">Пятница</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Примечания</label>
                <input className="form-input"
                  value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Название</label>
                <input className="form-input"
                  value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Грейд</label>
                <select className="form-input"
                  value={form.grade ?? 'Gold'}
                  onChange={(e) => setForm({ ...form, grade: e.target.value as 'Gold' | 'Silver' | 'Bronze' })}>
                  <option value="Gold">Gold</option>
                  <option value="Silver">Silver</option>
                  <option value="Bronze">Bronze</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Телефон</label>
                <div className="input-with-action">
                  <input className="form-input" placeholder="+7 900 000-00-00"
                    value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  <CopyButton value={form.phone} title="Скопировать номер" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Управляющий</label>
                <input className="form-input"
                  value={form.manager ?? ''} onChange={(e) => setForm({ ...form, manager: e.target.value })} />
              </div>
              <div className="dialog-actions">
                <button className="btn btn-outline" type="button" onClick={() => { setEditingId(null); resetForm(); }}>
                  Отмена
                </button>
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? 'Сохранение…' : editingId === 'new' ? 'Создать' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingClient && (
        <div className="dialog-overlay" onClick={() => setViewingClient(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div className="dialog-title">Клиент</div>
            <div className="dialog-body" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13, overflowY: 'auto' }}>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Активный</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.active ? '✅ Активный' : '❌ Не активный'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Клиент</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.name}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Форма</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.company || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Адрес</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.address || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Почта</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.email}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>День посещения</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.day || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Режим работы</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.mode || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Телефон</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.phone || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Управляющий</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.manager || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Примечания</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.notes || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Название</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.title || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Грейд</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.grade || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Создан</label>
                <div style={{ marginBottom: 10 }}>{viewingClient.createdAt || '—'}</div>
              </div>
              <div>
                <label className="form-label" style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, display: 'block' }}>Обновлён</label>
                <div style={{ marginBottom: 0 }}>{viewingClient.updatedAt || '—'}</div>
              </div>
            </div>
            <div className="dialog-actions">
              <button
                className="btn btn-outline"
                onClick={() => {
                  setViewingClient(null);
                  setForm({
                    name: viewingClient.name,
                    email: viewingClient.email,
                    phone: viewingClient.phone ?? '',
                    company: viewingClient.company ?? 'ИП',
                    address: viewingClient.address ?? '',
                    day: viewingClient.day ?? '',
                    mode: viewingClient.mode ?? '',
                    manager: viewingClient.manager ?? '',
                    notes: viewingClient.notes ?? '',
                    active: viewingClient.active ?? true,
                    title: viewingClient.title ?? '',
                    grade: viewingClient.grade ?? 'Gold',
                  });
                  setEditingId(viewingClient.id);
                }}
              >
                Править
              </button>
              <button
                className="btn btn-outline"
                style={{ color: '#b91c1c' }}
                onClick={() => { setViewingClient(null); handleDeleteConfirm(viewingClient.id, viewingClient.name) }}
              >
                Удалить
              </button>
              <button className="btn btn-outline" onClick={() => setViewingClient(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="dialog-overlay" onClick={() => { setDeleteTarget(null); setDeleteConfirmed(false); }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Удаление клиента</div>
            <div className="dialog-body">
              Вы уверены, что хотите удалить клиента <strong>{deleteTarget.name}</strong>? Это действие нельзя отменить.
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={deleteConfirmed}
                  onChange={(e) => setDeleteConfirmed(e.target.checked)}
                />
                <span>Подтверждаю удаление</span>
              </label>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmed(false); }}>Отмена</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={saving || !deleteConfirmed}>
                {saving ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}