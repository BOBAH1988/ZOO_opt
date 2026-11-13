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
import type { Client, NewClientInput } from '@/types';

interface ClientDoc extends DocumentData {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  company?: unknown;
  address?: unknown;
  day?: unknown;
  mode?: unknown;
  manager?: unknown;
  notes?: unknown;
  active?: unknown;
  title?: unknown;
  grade?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  ownerUid?: unknown;
}

function toIsoString(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return '';
    }
  }
  return '';
}

function docToClient(snap: QueryDocumentSnapshot<DocumentData>): Client | null {
  const data = snap.data() as ClientDoc;
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
  const [form, setForm] = useState<NewClientInput>({ name: '', email: '', phone: '', company: '', address: '', day: '', mode: '', manager: '', notes: '', active: true, title: '', grade: 'Gold' });
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
          const parsed = docToClient(snap);
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
    setForm({ name: '', email: '', phone: '', company: '', address: '', day: '', mode: '', manager: '', notes: '', active: true, title: '', grade: 'Gold' });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;
    setSaving(true);
    setError(null);
    try {
      const data: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone?.trim() || null,
        company: form.company?.trim() || null,
        address: form.address?.trim() || null,
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
    } finally {
      setSaving(false);
      resetForm();
      setEditingId(null);
    }
  };

  const handleUpdate = async (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;
    setSaving(true);
    setError(null);
    try {
      const data: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone?.trim() || null,
        company: form.company?.trim() || null,
        address: form.address?.trim() || null,
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
    } finally {
      setSaving(false);
      resetForm();
      setEditingId(null);
    }
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id} onClick={() => setViewingClient(client)} style={{ cursor: 'pointer' }}>
                  <td style={{ width: '48px', whiteSpace: 'nowrap', textAlign: 'center' }}>{client.active ? '✅' : '❌'}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.company || '—'}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong>{client.name}</strong>
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
            <div className="dialog-title">
              {editingId === 'new' ? 'Новый клиент' : 'Редактирование клиента'}
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
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
                <input className="form-input"
                  value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Адрес</label>
                <input className="form-input"
                  value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Почта</label>
                <input className="form-input" type="email" required
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">День посещения</label>
                <select className="form-input"
                  value={form.day}
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
                  value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Название</label>
                <input className="form-input"
                  value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Грейд</label>
                <select className="form-input"
                  value={form.grade}
                  onChange={(e) => setForm({ ...form, grade: e.target.value as 'Gold' | 'Silver' | 'Bronze' })}>
                  <option value="Gold">Gold</option>
                  <option value="Silver">Silver</option>
                  <option value="Bronze">Bronze</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Телефон</label>
                <input className="form-input"
                  value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Управляющий</label>
                <input className="form-input"
                  value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} />
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
                onClick={() => { setViewingClient(null); setForm({ name: viewingClient.name, email: viewingClient.email, phone: viewingClient.phone, company: viewingClient.company, address: viewingClient.address, day: viewingClient.day, mode: viewingClient.mode, manager: viewingClient.manager, notes: viewingClient.notes, active: viewingClient.active, title: viewingClient.title, grade: viewingClient.grade ?? 'Gold' }); setEditingId(viewingClient.id); }}
              >
                Редактировать
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