import { useState, useEffect } from 'react';
import {
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { runWorkflow, isApiConfigured } from '@/api';
import { db } from '@/firebase';
import { useAuth } from '@/context/AuthContext';
import type { WorkflowScenario, WorkflowInput } from '@/types';

const PROJECT_OPTIONS = [
  { label: 'order', value: 'order' },
  { label: 'ukhta', value: 'ukhta' },
  { label: 'veta', value: 'veta' },
  { label: 'clients', value: 'clients' },
  { label: 'payments', value: 'payments' },
  { label: 'invoice', value: 'invoice' },
  { label: 'veles', value: 'veles' },
  { label: 'lemur', value: 'lemur' },
  { label: 'dz', value: 'dz' },
  { label: 'sety', value: 'sety' },
];

const SCENARIOS: WorkflowScenario[] = [
  {
    id: 'weekly_mon_tue',
    name: 'Прайс Ухта, Лемур, Дебеторка, счет Вета',
    day: 'пн',
    time: '9:00',
    description: 'Диспетчер проектов группы понедельник-вторник (заказ, Ухта, ВЕТА, дебиторка, счета, платёжки, прайс Лемур).',
    warning: null,
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: false, description: '', required: false },
      { key: 'only', label: 'Проекты для запуска', type: 'multiselect', defaultValue: [], description: 'Пусто = вся группа', required: false, options: PROJECT_OPTIONS },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'weekly_residues',
    name: 'Рекомендации к заказу по остаткам',
    day: 'пн',
    time: '10:00',
    description: 'Отчёт «Рекомендации к заказу» на основе остатков и продаж.',
    warning: null,
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам)', type: 'boolean', defaultValue: false, description: '', required: false },
    ],
  },
  {
    id: 'weekly_sety_price',
    name: 'Прайсы Сети + ИП Мамедов',
    day: 'пн',
    time: '9:00',
    description: 'Рассылка прайса сети магазинов и ИП Мамедов. Внимание: по умолчанию рассылка идёт реальным получателям.',
    warning: null,
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не сетям)', type: 'boolean', defaultValue: false, description: '', required: false },
      { key: 'skip_if_sent', label: 'Не дублировать рассылку', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'weekly_tue',
    name: 'Прайс Ухта, счета, платежки',
    day: 'вт',
    time: '9:00',
    description: 'Диспетчер проектов группы вторник (прайс Ухта, счета, платёжки).',
    warning: null,
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: false, description: '', required: false },
      { key: 'only', label: 'Проекты для запуска', type: 'multiselect', defaultValue: [], description: 'Пусто = вся группа', required: false, options: PROJECT_OPTIONS },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'weekly_wed',
    name: 'Счета Велес и Прусакова',
    day: 'ср',
    time: '14:00',
    description: 'Диспетчер проектов группы среда (счёт Прусакова клиенту, счета в Велес).',
    warning: null,
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: false, description: '', required: false },
      { key: 'only', label: 'Проекты для запуска', type: 'multiselect', defaultValue: [], description: 'Пусто = вся группа', required: false, options: [
        { label: 'счёт Прусакова клиенту', value: 'prusakova' },
        { label: 'счета в Велес', value: 'veles' },
      ] },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'weekly_fri',
    name: 'Прайс Лемур, отчет по дебеторке',
    day: 'пт',
    time: '9:00',
    description: 'Диспетчер проектов группы пятница (прайс Лемур, ответ по дебиторке и др.).',
    warning: null,
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: false, description: '', required: false },
      { key: 'only', label: 'Проекты для запуска', type: 'multiselect', defaultValue: [], description: 'Пусто = вся группа', required: false, options: PROJECT_OPTIONS },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'kpi_sales',
    name: 'KPI Продажи',
    day: '',
    description: 'Личный отчёт выполнения KPI «Продажи». Письмо уходит только владельцу на NOTIFY_EMAIL.',
    warning: null,
    testModeDefault: true,
    inputs: [],
  },
];

type InputValues = Record<string, Record<string, boolean | string | string[]>>;

function defaultInputs(scenario: WorkflowScenario): Record<string, boolean | string | string[]> {
  const out: Record<string, boolean | string | string[]> = {};
  for (const input of scenario.inputs) out[input.key] = input.defaultValue;
  return out;
}

export function RunProcessesPage() {
  const { user } = useAuth();
  const [running, setRunning] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<{ id: string; name: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<WorkflowScenario | null>(null);
  const [openMultiselect, setOpenMultiselect] = useState<Record<string, boolean>>({});
  const [runStatus, setRunStatus] = useState<Record<string, 'ok' | 'error'>>({});
  const [inputValues, setInputValues] = useState<InputValues>(() => {
    const init: InputValues = {};
    for (const s of SCENARIOS) init[s.id] = defaultInputs(s);
    try {
      const raw = localStorage.getItem('zoo-opt-run-settings');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<InputValues>;
        for (const s of SCENARIOS) {
          if (parsed[s.id]) {
            init[s.id] = { ...init[s.id], ...parsed[s.id] };
          }
        }
      }
    } catch {
      // игнорируем ошибки чтения localStorage
    }
    return init;
  });

  const apiConfigured = isApiConfigured();

  // Сохраняем настройки при каждом изменении
  useEffect(() => {
    try {
      localStorage.setItem('zoo-opt-run-settings', JSON.stringify(inputValues));
    } catch {
      // игнорируем ошибки записи localStorage
    }
  }, [inputValues]);

  function inputsEqual(
    a: Record<string, boolean | string | string[]>,
    b: Record<string, boolean | string | string[]>
  ): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!(key in b)) return false;
      const va = a[key];
      const vb = b[key];
      if (Array.isArray(va) && Array.isArray(vb)) {
        if (va.length !== vb.length) return false;
        for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
      } else if (va !== vb) {
        return false;
      }
    }
    return true;
  }

  function hasChanges(scenarioId: string): boolean {
    const current = inputValues[scenarioId];
    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario || !current) return false;
    const defaults = defaultInputs(scenario);
    return !inputsEqual(current, defaults);
  }

  const setInput = (scenarioId: string, key: string, value: boolean | string | string[]) => {
    setInputValues((prev) => ({ ...prev, [scenarioId]: { ...prev[scenarioId], [key]: value } }));
  };

  const toggleMultiselect = (scenarioId: string, key: string, value: string) => {
    setInputValues((prev) => {
      const cur = (prev[scenarioId]?.[key] as string[] | undefined) || [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [scenarioId]: { ...prev[scenarioId], [key]: next } };
    });
  };

  const toggleMultiselectOpen = (scenarioId: string, key: string) => {
    setOpenMultiselect((prev) => ({ ...prev, [`${scenarioId}.${key}`]: !prev[`${scenarioId}.${key}`] }));
  };

  const writeLog = async (payload: {
    workflowId: string;
    workflowName: string;
    status: 'accepted' | 'error';
    message: string;
    runUrl?: string | null;
    inputs: Record<string, boolean | string>;
  }) => {
    if (!db || !user) return;
    try {
      await addDoc(collection(db, 'runLogs'), {
        ...payload,
        requestedBy: user.uid,
        requestedByEmail: user.email || null,
        createdAt: serverTimestamp(),
      });
    } catch {
      // журнал не должен блокировать UX запуска
    }
  };

  const handleRunClick = (scenario: WorkflowScenario) => {
    setConfirmOpen({ id: scenario.id, name: scenario.name });
  };

  const handleConfirm = () => {
    if (!confirmOpen) return;
    const scenario = SCENARIOS.find((s) => s.id === confirmOpen.id);
    if (scenario) {
      setConfirmOpen(null);
      void executeRun(scenario);
    }
  };

  const executeRun = async (scenario: WorkflowScenario) => {
    const rawInputs = inputValues[scenario.id] || {};
    const inputs: Record<string, boolean | string> = {};
    for (const [k, v] of Object.entries(rawInputs)) {
      inputs[k] = Array.isArray(v) ? v.join(',') : v;
    }
    setRunning(scenario.id);

    if (!apiConfigured) {
      const message = 'Запуск не настроен: отсутствует серверный API.';
      await writeLog({ workflowId: scenario.id, workflowName: scenario.name, status: 'error', message, inputs });
      setRunning(null);
      return;
    }

    try {
      const response = await runWorkflow({ workflowId: scenario.id, inputs });
      setRunStatus((prev) => ({ ...prev, [scenario.id]: 'ok' }));
      await writeLog({
        workflowId: scenario.id,
        workflowName: scenario.name,
        status: 'accepted',
        message: response.message,
        runUrl: response.runUrl ?? null,
        inputs,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка при запуске';
      setRunStatus((prev) => ({ ...prev, [scenario.id]: 'error' }));
      await writeLog({ workflowId: scenario.id, workflowName: scenario.name, status: 'error', message, inputs });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      <h2 className="page-title">Запуск</h2>
      {!apiConfigured && (
        <div className="alert alert-warning" style={{ marginBottom: 8 }}>
          <strong>Запуск не настроен:</strong> отсутствует серверный API (VITE_API_BASE_URL).
          Сервер должен проверять Firebase ID token, валидировать workflow и параметры по белому списку и вести журнал запусков.
        </div>
      )}
      <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr' }}>
        {SCENARIOS.map((scenario) => {
          return (
            <div key={scenario.id} className="card" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 15, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                {scenario.day}{scenario.time ? ` ${scenario.time}` : ''}
              </span>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{scenario.name}</h3>
              {runStatus[scenario.id] === 'ok' ? (
                <span className="btn btn-success" style={{ width: '100%', padding: '6px 10px', fontSize: 13, textAlign: 'center', display: 'block' }}>Ок</span>
              ) : runStatus[scenario.id] === 'error' ? (
                <span className="btn btn-danger" style={{ width: '100%', padding: '6px 10px', fontSize: 13, textAlign: 'center', display: 'block' }}>Сбой</span>
              ) : (
                <button className="btn btn-primary" onClick={() => handleRunClick(scenario)} disabled={running === scenario.id}>
                  {running === scenario.id ? 'Запуск…' : 'Запустить'}
                </button>
              )}
              <button
                className="btn btn-outline"
                onClick={() => setSettingsOpen(scenario)}
                title="Настройка"
                style={{
                  ...(hasChanges(scenario.id) && {
                    outline: '1px solid #ef4444',
                    outlineOffset: '1px',
                  }),
                }}
              >
                ⚙️
              </button>

              {scenario.warning && (
                <div style={{ gridColumn: '1 / -1', padding: 4, background: '#fbf4e3', borderRadius: 6, fontSize: 11, color: '#92400e', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                  ⚠️ {scenario.warning}
                </div>
              )}
            </div>
          );
        })}
      </div>



      {confirmOpen && (
        <div className="dialog-overlay" onClick={() => setConfirmOpen(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Точно запустить?</div>
            <div className="dialog-body">
              Вы собираетесь запустить <strong>{confirmOpen.name}</strong>.
            </div>
            <div className="dialog-actions">
              <button className="btn" style={{ background: 'rgba(21, 128, 61, 0.75)', color: '#ffffff' }} onClick={handleConfirm}>Да</button>
              <button className="btn" style={{ background: 'rgba(185, 28, 28, 0.75)', color: '#ffffff' }} onClick={() => setConfirmOpen(null)}>Нет</button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="dialog-overlay" onClick={() => setSettingsOpen(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Настройка</div>
            <div className="dialog-body">
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{settingsOpen.description}</p>
              {settingsOpen.inputs.length > 0 ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {settingsOpen.inputs.map((input: WorkflowInput) => {
                    const val = inputValues[settingsOpen.id]?.[input.key];
                    return (
                      <div key={input.key} className="form-group" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {input.type === 'boolean' ? (
                            <>
                              <label className="form-label" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(val)}
                                  onChange={(e) => setInput(settingsOpen.id, input.key, e.target.checked)}
                                />
                                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{input.label}</span>
                              </label>
                            </>
                          ) : input.type === 'multiselect' ? (
                            <>
                              <label className="form-label" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0, cursor: 'pointer' }} title={input.description || input.label}>
                                {input.label}
                              </label>
                              <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
                                <button
                                  className="btn btn-outline"
                                  style={{ width: '100%', padding: '6px 10px', fontSize: 13, textAlign: 'left' }}
                                  onClick={(e) => { e.stopPropagation(); toggleMultiselectOpen(settingsOpen.id, input.key); }}
                                  title={input.description || input.label}
                                >
                                  {Array.isArray(val) && val.length > 0 ? val.join(', ') : 'Все'}
                                </button>
                                {openMultiselect[`${settingsOpen.id}.${input.key}`] && (
                                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 20px rgba(0,0,0,0.15)', padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                                    {(input.options || []).map((opt) => {
                                      const cur = (val as string[] | undefined) || [];
                                      return (
                                        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                                          <input
                                            type="checkbox"
                                            checked={cur.includes(opt.value)}
                                            onChange={(e) => { e.stopPropagation(); toggleMultiselect(settingsOpen.id, input.key, opt.value); }}
                                          />
                                          {opt.label}
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </>
                          ) : (
                            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{input.label}</span>
                          )}
                          {input.type === 'string' && (
                            <input
                              className="form-input"
                              value={String(val ?? '')}
                              onChange={(e) => setInput(settingsOpen.id, input.key, e.target.value)}
                              placeholder={input.description}
                            />
                          )}
                          {input.description && (
                            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, overflowWrap: 'anywhere' }}>{input.description}</div>
                          )}
                        </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: '#6b7280' }}>Нет настроек.</p>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={() => setSettingsOpen(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
