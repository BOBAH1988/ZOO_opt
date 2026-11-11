import { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { EmptyState } from '@/components/EmptyState';
import type { Client, NewClientInput } from '@/types';

interface ClientDoc extends DocumentData {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  notes?: string;
  createdAt: any;
  updatedAt: any;
  ownerUid: string;
}

function docToClient(snap: QueryDocumentSnapshot<DocumentData>): Client {
  const data = snap.data() as ClientDoc;
  return {
    id: snap.id,
    name: data.name || '',
    email: data.email || '',
    phone: data.phone || undefined,
    company: data.company || undefined,
    notes: data.notes || undefined,
    createdAt: data.createdAt?.toString?.() || '',
    updatedAt: data.updatedAt?.toString?.() || '',
    ownerUid: data.ownerUid || '',
  };
}

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<NewClientInput>({ name: '', email: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured() || !db) {
      setError('Firebase не сконфигурирован. Настройте VITE_FIREBASE_* переменные окружения.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(db, 'clients'),
      orderBy('updatedAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Client[] = [];
        snapshot.forEach((snap: QueryDocumentSnapshot<DocumentData>) => {
          try {
            list.push(docToClient(snap));
          } catch {
            // Пропускаем документы с некорректной структурой
          }
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
  }, [db]);

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    (c.company && c.company.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'clients'), {
        ...form,
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerUid: 'current-user',
      });
      setForm({ name: '', email: '' });
    } catch (err: any) {
      setError(err?.message || 'Ошибка создания клиента');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'clients', id), {
        ...form,
        updatedAt: new Date(),
      });
      setEditingId(null);
      setForm({ name: '', email: '' });
    } catch (err: any) {
      setError(err?.message || 'Ошибка обновления клиента');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = (id: string, name: string) => {
    setDeleteTarget({ id, name });
  };

  const handleDelete = async () => {
    if (!deleteTarget || !db) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'clients', deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err?.message || 'Ошибка удаления клиента');
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
        <button className="btn btn-primary" onClick={() => setEditingId('new')}>
          + Добавить клиента
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

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
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Email</th>
                <th>Телефон</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.name}</strong>
                      {client.company ? (
                        <>
                          <br />
                          <span style={{ fontSize: 12, color: '#6b7280' }}>{client.company}</span>
                        </>
                      ) : null}
                  </td>
                  <td>{client.email}</td>
                  <td>{client.phone || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setForm({ name: client.name, email: client.email, phone: client.phone, company: client.company, notes: client.notes });
                        setEditingId(client.id);
                      }}
                    >
                      Редактировать
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleDeleteConfirm(client.id, client.name)}
                      style={{ color: '#b91c1c' }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingId && (
        <div className="dialog-overlay" onClick={() => setEditingId(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">
              {editingId === 'new' ? 'Новый клиент' : 'Редактирование клиента'}
            </div>
            <form
              onSubmit={(e) =>
                editingId === 'new' ? handleCreate(e) : handleUpdate(editingId, e)
              }
            >
              <div className="form-group">
                <label className="form-label">Имя / организация</label>
                <input className="form-input" required
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" required
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Телефон</label>
                <input className="form-input"
                  value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value || undefined })} />
              </div>
              <div className="form-group">
                <label className="form-label">Компания</label>
                <input className="form-input"
                  value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value || undefined })} />
              </div>
              <div className="form-group">
                <label className="form-label">Примечания</label>
                <input className="form-input"
                  value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value || undefined })} />
              </div>
              <div className="dialog-actions">
                <button className="btn btn-outline" type="button" onClick={() => setEditingId(null)}>
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

      {deleteTarget && (
        <div className="dialog-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Удаление клиента</div>
            <div className="dialog-body">
              Вы уверены, что хотите удалить клиента <strong>{deleteTarget.name}</strong>? Это действие нельзя отменить.
            </div>
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={() => setDeleteTarget(null)}>Отмена</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={saving}>
                {saving ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}