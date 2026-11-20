import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase';
import { isFirebaseConfigured } from '@/firebase.config';
import { useAuth } from '@/context/AuthContext';
import { EmptyState } from '@/components/EmptyState';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Сценарий рассылки, в который входит адрес. */
type ListKind = 'ukhta' | 'sety' | 'debt' | 'lemur';

const KIND_LABELS: Record<ListKind, string> = {
  ukhta: 'Прайс Ухта',
  sety: 'Прайс Сети',
  debt: 'Дебиторка Ухта',
  lemur: 'Прайс Лемур',
};

const KIND_SHORT: Record<ListKind, string> = {
  ukhta: 'Ухта',
  sety: 'Сети',
  debt: 'Долг',
  lemur: 'Лемур',
};

const ALL_KINDS: ListKind[] = ['ukhta', 'sety', 'debt', 'lemur'];

/**
 * Одна запись списка.
 *
 * id — стабильный ключ записи. Скрипты ссылаются на него, поэтому
 * переименование списка или правка адреса не ломает связей.
 * kinds — сценарии рассылки: один адрес может получать и прайс, и дебиторку.
 */
interface ListEntry {
  id: string;
  email: string;
  name?: string;
  kinds: ListKind[];
  active: boolean;
}

const STORAGE_KEY_SEED = 'zoo.lists.seeded.v2';

/** Разбирает поля записи из документа, пропуская битые. */
function readEntry(item: unknown): ListEntry | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const email = typeof raw.email === 'string' ? raw.email.trim() : '';
  if (!email) return null;

  // Новая модель хранит массив kinds; старая — одно поле kind.
  let kinds: ListKind[] = [];
  if (Array.isArray(raw.kinds)) {
    kinds = raw.kinds.filter((k): k is ListKind => ALL_KINDS.includes(k as ListKind));
  } else if (typeof raw.kind === 'string' && ALL_KINDS.includes(raw.kind as ListKind)) {
    kinds = [raw.kind as ListKind];
  }

  return {
    id: typeof raw.id === 'string' ? raw.id.trim() : '',
    email,
    name: typeof raw.name === 'string' && raw.name ? raw.name : undefined,
    kinds: kinds.length > 0 ? kinds : ['ukhta'],
    active: raw.active !== false,
  };
}

/**
 * Следующий свободный номер записи: трёхзначное число 001…999.
 * Номера не переиспользуются в пределах набора — занятые пропускаются,
 * поэтому id остаётся стабильным ключом, на который ссылаются скрипты.
 */
function nextId(existing: ListEntry[]): string {
  const used = new Set(existing.map((item) => item.id));
  for (let n = 1; n <= 999; n += 1) {
    const candidate = String(n).padStart(3, '0');
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Свободные номера закончились: в списке уже 999 записей');
}

/**
 * Раздаёт номера записям без id и убирает повторы.
 *
 * ЗАЧЕМ
 * Раньше import писал записи с пустым id — все 50 строк получали одинаковый
 * ключ, ломали список React и не находились по номеру. Здесь битые записи
 * получают первый свободный номер, а повторы почты склеиваются в одну.
 */
function normalizeEntries(raw: ListEntry[]): ListEntry[] {
  const used = new Set<string>();
  const byEmail = new Map<string, ListEntry>();

  for (const item of raw) {
    const key = normalizeEmail(item.email);
    if (!key) continue;

    const existing = byEmail.get(key);
    if (existing) {
      // Один адрес — одна запись, сценарии объединяем.
      for (const kind of item.kinds) {
        if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      }
      if (!existing.name && item.name) existing.name = item.name;
      continue;
    }

    const record: ListEntry = {
      id: item.id,
      email: item.email,
      kinds: [...item.kinds],
      active: item.active,
      ...(item.name ? { name: item.name } : {}),
    };
    byEmail.set(key, record);
  }

  // Первый проход: сохраняем валидные номера (без повторов).
  const ordered = [...byEmail.values()];
  for (const item of ordered) {
    if (/^\d{3}$/.test(item.id) && !used.has(item.id)) {
      used.add(item.id);
    } else {
      item.id = '';
    }
  }

  // Второй проход: свободные номера по возрастанию.
  let counter = 0;
  for (const item of ordered) {
    if (item.id) continue;
    do {
      counter += 1;
      if (counter > 999) break;
    } while (used.has(String(counter).padStart(3, '0')));
    item.id = String(counter).padStart(3, '0');
    used.add(item.id);
  }

  return ordered;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function ListsPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState<ListKind | 'all'>('all');
  const [editing, setEditing] = useState<ListEntry | null>(null);
  const [editingIsNew, setEditingIsNew] = useState(false);
  const [importPreview, setImportPreview] = useState<ListEntry[] | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!user) {
      setEntries([]);
      setLoading(false);
      return;
    }
    if (!isFirebaseConfigured() || !db) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'mail_lists', user.uid),
      (snap) => {
        const data = snap.data();
        const raw = data && Array.isArray(data.addresses) ? data.addresses : [];
        const parsed = raw
          .map(readEntry)
          .filter((item): item is ListEntry => item !== null);
        setEntries(normalizeEntries(parsed));
        setLoading(false);
      },
      (err) => {
        setError(err?.message || 'Не удалось загрузить список получателей');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user]);

  /**
   * Готовит запись к записи в Firestore.
   *
   * Firestore отвергает документ с любым полем, равным undefined
   * («Unsupported field value: undefined»). Поэтому пустое имя не пишем
   * вовсе, а не кладём как undefined — иначе сохранение падает целиком.
   */
  const toFirestore = (item: ListEntry) => {
    const data: Record<string, unknown> = {
      id: item.id,
      email: item.email,
      kinds: item.kinds,
      active: item.active,
    };
    const name = item.name?.trim();
    if (name) data.name = name;
    return data;
  };

  const save = async (next: ListEntry[]) => {
    if (!db || !user) return false;
    setSaving(true);
    setError(null);
    try {
      await setDoc(doc(db, 'mail_lists', user.uid), {
        ownerUid: user.uid,
        addresses: next.map(toFirestore),
        updatedAt: serverTimestamp(),
      });
      setEntries(next);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить список');
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Открывает окно для новой записи. */
  const openNew = () => {
    try {
      setEditing({ id: nextId(entries), email: '', name: '', kinds: ['ukhta'], active: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось создать запись');
      return;
    }
    setEditingIsNew(true);
  };

  /** Открывает окно для существующей записи. */
  const openEdit = (entry: ListEntry) => {
    setEditing({ ...entry });
    setEditingIsNew(false);
  };

  /** Сохраняет запись из окна: и новую, и отредактированную. */
  const handleSaveEntry = async () => {
    if (!editing) return;
    const email = normalizeEmail(editing.email);
    if (!EMAIL_PATTERN.test(email)) {
      setError('Почта должна быть в формате name@example.com');
      return;
    }
    if (editing.kinds.length === 0) {
      setError('Выберите хотя бы один список');
      return;
    }

    // Один адрес — одна запись. Дубль другого id с той же почтой отклонится.
    const clash = entries.some(
      (item) => item.id !== editing.id && normalizeEmail(item.email) === email,
    );
    if (clash) {
      setError('Этот адрес уже есть в списке — откройте его строку и отредактируйте');
      return;
    }

    const trimmedName = editing.name?.trim();
    const record: ListEntry = {
      id: editing.id,
      email,
      kinds: ALL_KINDS.filter((kind) => editing.kinds.includes(kind)),
      active: editing.active,
      ...(trimmedName ? { name: trimmedName } : {}),
    };

    const next = editingIsNew
      ? [...entries, record]
      : entries.map((item) => (item.id === record.id ? record : item));

    if (await save(next)) {
      setEditing(null);
    }
  };

  /** Удаляет запись из окна редактирования. */
  const handleDeleteEntry = async () => {
    if (!editing) return;
    const confirmed = window.confirm(
      `Удалить «${editing.email}» из всех списков?\n\nЕсли адрес может понадобиться снова, вместо удаления снимите галочку «Активен».`,
    );
    if (!confirmed) return;

    const next = entries.filter((item) => item.id !== editing.id);
    if (await save(next)) {
      setEditing(null);
    }
  };

  /** Переключает активность прямо в строке. */
  const handleToggleActive = async (entry: ListEntry) => {
    const next = entries.map((item) =>
      item.id === entry.id ? { ...item, active: !item.active } : item,
    );
    await save(next);
  };

  const parseSeedFile = (text: string, kind: ListKind): Array<{ email: string; name?: string }> => {
    const result: Array<{ email: string; name?: string }> = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      if (kind === 'debt' && line.includes(' - ')) {
        const idx = line.lastIndexOf(' - ');
        const name = line.slice(0, idx).replace(/\.xls$/i, '').trim();
        const email = normalizeEmail(line.slice(idx + 3));
        if (email) result.push({ email, name: name || undefined });
        continue;
      }

      const email = normalizeEmail(line);
      if (email) result.push({ email });
    }
    return result;
  };

  /** Читает три файла и склеивает дубли: один адрес — одна запись со всеми списками. */
  const handleLoadSeeds = async () => {
    setError(null);
    setImporting(true);
    try {
      const base = import.meta.env.BASE_URL;
      const files: Array<{ name: string; kind: ListKind }> = [
        { name: 'recipients_ukhta.txt', kind: 'ukhta' },
        { name: 'recipients_sety_ukhta.txt', kind: 'sety' },
        { name: 'clients_debt_ukhta.txt', kind: 'debt' },
      ];

      // Номера свободных строк выдаём подряд после уже занятых.
      let counter = 0;
      const nextFree = () => {
        let id = '';
        do {
          counter += 1;
          if (counter > 999) throw new Error('Свободные номера закончились: в списке уже 999 записей');
          id = String(counter).padStart(3, '0');
        } while (entries.some((item) => item.id === id));
        return id;
      };

      const byEmail = new Map<string, ListEntry>();
      for (const file of files) {
        const response = await fetch(`${base}list-seeds/${file.name}`);
        if (!response.ok) continue;
        for (const row of parseSeedFile(await response.text(), file.kind)) {
          const existing = byEmail.get(row.email);
          if (existing) {
            if (!existing.kinds.includes(file.kind)) existing.kinds.push(file.kind);
            if (!existing.name && row.name) existing.name = row.name;
          } else {
            byEmail.set(row.email, {
              id: nextFree(),
              email: row.email,
              kinds: [file.kind],
              active: true,
              ...(row.name ? { name: row.name } : {}),
            });
          }
        }
      }

      if (byEmail.size === 0) {
        setError('Не удалось прочитать ни одного файла со списками.');
        return;
      }

      // Адреса, которые уже есть в базе, оставляем как есть — их id не меняем.
      const known = new Set(entries.map((item) => normalizeEmail(item.email)));
      const fresh = [...byEmail.values()].filter((item) => !known.has(item.email));

      if (fresh.length === 0) {
        setError('Все адреса из файлов уже есть в списке.');
        return;
      }
      setImportPreview(fresh);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить файлы со списками');
    } finally {
      setImporting(false);
    }
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    if (await save([...entries, ...importPreview])) {
      try {
        localStorage.setItem(STORAGE_KEY_SEED, '1');
      } catch {
        // хранилище недоступно — не критично
      }
      setImportPreview(null);
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter((item) => (filterKind === 'all' ? true : item.kinds.includes(filterKind)))
      .filter(
        (item) =>
          !needle ||
          item.email.includes(needle) ||
          (item.name ?? '').toLowerCase().includes(needle) ||
          item.id.includes(needle),
      )
      .sort((a, b) => a.email.localeCompare(b.email));
  }, [entries, filterKind, search]);

  const counts = useMemo(
    () => ({
      ukhta: entries.filter((e) => e.kinds.includes('ukhta')).length,
      sety: entries.filter((e) => e.kinds.includes('sety')).length,
      debt: entries.filter((e) => e.kinds.includes('debt')).length,
      lemur: entries.filter((e) => e.kinds.includes('lemur')).length,
      active: entries.filter((e) => e.active).length,
    }),
    [entries],
  );

  if (!isFirebaseConfigured() || !db) {
    return (
      <div className="card">
        <h2 className="card-title">Списки получателей</h2>
        <div className="alert alert-warning">
          Firebase не сконфигурирован. Списки будут доступны после настройки Firestore.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title-row">
        <h2 className="page-title" style={{ margin: 0 }}>Списки получателей</h2>
        <button type="button" className="btn btn-primary" onClick={openNew} disabled={saving}>
          + Добавить
        </button>
      </div>

      {error && <div className="alert alert-danger" style={{ marginTop: 8 }}>{error}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="stats-row">
          <div className="stat-tile">
            <div className="stat-label">Всего адресов</div>
            <div className="stat-value">{entries.length}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Прайс Ухта</div>
            <div className="stat-value">{counts.ukhta}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Прайс Сети</div>
            <div className="stat-value">{counts.sety}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Дебиторка</div>
            <div className="stat-value">{counts.debt}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Прайс Лемур</div>
            <div className="stat-value">{counts.lemur}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input
            className="form-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по адресу, имени или id"
            style={{ flex: '1 1 220px', minWidth: 0 }}
          />
          <select
            className="form-input"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as ListKind | 'all')}
            style={{ width: 'auto' }}
          >
            <option value="all">Все списки</option>
            {ALL_KINDS.map((kind) => (
              <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleLoadSeeds}
            disabled={saving || importing}
            title="Прочитать адреса из файлов recipients_ukhta, recipients_sety_ukhta и clients_debt_ukhta"
          >
            {importing ? 'Чтение файлов…' : 'Загрузить из файлов'}
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: 24 }}>
            Загрузка списка…
          </p>
        ) : visible.length === 0 ? (
          <EmptyState
            title="Список пуст"
            description="Нажмите «Загрузить из файлов», чтобы перенести текущие списки, или «Добавить» для новой записи. Пока список не заполнен, рассылки используют файлы из репозитория."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 84 }}>ID</th>
                  <th>Почта</th>
                  <th>Имя</th>
                  <th>Списки</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => openEdit(item)}
                    style={{
                      opacity: item.active ? 1 : 0.55,
                      cursor: 'pointer',
                    }}
                    title="Открыть для редактирования"
                  >
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {item.id}
                    </td>
                    <td style={{ fontSize: 13, wordBreak: 'break-all' }}>{item.email}</td>
                    <td style={{ fontSize: 13 }}>{item.name || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {item.kinds.map((kind) => (
                          <span
                            key={kind}
                            className={`badge ${item.active ? 'bg-test' : 'bg-real'}`}
                            style={{ fontSize: 11 }}
                          >
                            {KIND_SHORT[kind]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleActive(item);
                        }}
                        disabled={saving}
                      >
                        {item.active ? 'Активен' : 'Отключён'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          Нажмите на строку, чтобы изменить почту, имя, списки или активность.
          Отключённый адрес остаётся в списке, но рассылка его пропускает.
        </div>
      </div>

      {editing && (
        <div className="dialog-overlay" onClick={() => setEditing(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <h3 style={{ marginTop: 0 }}>
              {editingIsNew ? 'Новый адрес' : 'Редактирование адреса'}
            </h3>

            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
              ID: <code>{editing.id}</code> — по нему адрес связан со скриптами. Менять не нужно.
            </div>

            <label className="form-field">
              <span className="form-label">Почта</span>
              <input
                className="form-input"
                type="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                placeholder="name@example.com"
                autoComplete="off"
              />
            </label>

            <label className="form-field" style={{ marginTop: 10 }}>
              <span className="form-label">Имя или магазин</span>
              <input
                className="form-input"
                type="text"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Необязательно"
                autoComplete="off"
              />
            </label>

            <div style={{ marginTop: 12 }}>
              <div className="form-label">Списки рассылок</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {ALL_KINDS.map((kind) => (
                  <label key={kind} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={editing.kinds.includes(kind)}
                      onChange={(e) => {
                        const kinds = e.target.checked
                          ? [...editing.kinds, kind]
                          : editing.kinds.filter((k) => k !== kind);
                        setEditing({ ...editing, kinds });
                      }}
                    />
                    {KIND_LABELS[kind]}
                  </label>
                ))}
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              Активен (участвует в рассылках)
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveEntry}
                disabled={saving}
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
              {!editingIsNew && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleDeleteEntry}
                  disabled={saving}
                  style={{ color: '#dc2626', borderColor: '#dc2626' }}
                >
                  Удалить
                </button>
              )}
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {importPreview && (
        <div className="dialog-overlay" onClick={() => setImportPreview(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column', maxWidth: 620 }}
          >
            <h3 style={{ marginTop: 0 }}>Добавить {importPreview.length} адресов?</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Дубли из разных файлов склеены в одну строку с несколькими списками.
              Уже существующие адреса не показаны.
            </p>
            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--color-border)', borderRadius: 6 }}>
              <table className="table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 72 }}>ID</th>
                    <th style={{ minWidth: 200 }}>Почта</th>
                    <th>Имя</th>
                    <th style={{ minWidth: 110 }}>Списки</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {item.id}
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{item.email}</td>
                      <td style={{ fontSize: 12 }}>{item.name || '—'}</td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {item.kinds.map((kind) => KIND_SHORT[kind]).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn-outline" onClick={() => setImportPreview(null)}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" onClick={handleImportConfirm} disabled={saving}>
                {saving ? 'Сохранение…' : `Добавить ${importPreview.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
