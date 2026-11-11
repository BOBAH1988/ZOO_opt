import { useState } from 'react';
import {
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { runWorkflow, isApiConfigured } from '@/api';
import { db } from '@/firebase';
import { useAuth } from '@/context/AuthContext';
import type { WorkflowScenario, WorkflowInput } from '@/types';

const SCENARIOS: WorkflowScenario[] = [
  {
    id: 'tests',
    name: 'Тесты (стенд)',
    description: 'Прогон автоматических тестов без отправки реальных писем. Безопасен для частого запуска.',
    warning: null,
    testModeDefault: true,
    inputs: [],
  },
  {
    id: 'kpi_sales',
    name: 'KPI Продажи (ручной запуск)',
    description: 'Личный отчёт выполнения KPI «Продажи». Письмо уходит только владельцу на NOTIFY_EMAIL.',
    warning: 'Это может отправить реальное письмо с личным отчётом на вашу электронную почту.',
    testModeDefault: true,
    inputs: [],
  },
  {
    id: 'weekly_fri',
    name: 'Почта пятница',
    description: 'Диспетчер проектов группы пятница (прайс Лемур, ответ по дебиторке и др.).',
    warning: 'В нетестовом режиме рассылка уйдёт реальным клиентам и партнёрам.',
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: true, description: 'Письма уйдут только на вашу почту, реальные клиенты не получат рассылку', required: false },
      { key: 'only', label: 'Один проект (ключ)', type: 'string', defaultValue: '', description: 'Например: lemur, dz, order, ukhta, veta, clients, payments, invoice, veles, sety. Пусто = вся группа', required: false },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: 'Запустить независимо от текущего времени и дня', required: false },
    ],
  },
  {
    id: 'weekly_mon_tue',
    name: 'Почта пн-вт',
    description: 'Диспетчер проектов группы понедельник-вторник (заказ, Ухта, ВЕТА, дебиторка, счета, платёжки, прайс Лемур).',
    warning: 'В нетестовом режиме рассылка уйдёт реальным клиентам и партнёрам.',
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: true, description: 'Письма уйдут только на вашу почту, реальные клиенты не получат рассылку', required: false },
      { key: 'only', label: 'Один проект (ключ)', type: 'string', defaultValue: '', description: 'Например: order, ukhta, veta, clients, payments, invoice, veles, lemur, dz, sety. Пусто = вся группа', required: false },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: 'Запустить независимо от текущего времени и дня', required: false },
    ],
  },
  {
    id: 'weekly_wed',
    name: 'Почта среда',
    description: 'Диспетчер проектов группы среда (счёт Прусакова клиенту, счета в Велес).',
    warning: 'В нетестовом режиме рассылка уйдёт реальным клиентам и партнёрам.',
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: true, description: 'Письма уйдут только на вашу почту, реальные клиенты не получат рассылку', required: false },
      { key: 'only', label: 'Один проект (ключ)', type: 'string', defaultValue: '', description: 'Например: invoice, veles, order, ukhta, veta, clients, payments, lemur, dz, sety. Пусто = вся группа', required: false },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: 'Запустить независимо от текущего времени и дня', required: false },
    ],
  },
  {
    id: 'weekly_residues',
    name: 'Рекомендации к заказу (пн)',
    description: 'Отчёт «Рекомендации к заказу» на основе остатков и продаж.',
    warning: 'В нетестовом режиме отчёт уйдёт на вашу электронную почту.',
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам)', type: 'boolean', defaultValue: true, description: 'Отчёт уйдёт только вам, копия руководителю не добавляется', required: false },
    ],
  },
  {
    id: 'weekly_sety_price',
    name: 'Прайсы понедельника (сети + ИП Мамедов)',
    description: 'Рассылка прайса сети магазинов и ИП Мамедов. Внимание: по умолчанию рассылка идёт реальным получателям.',
    warning: 'В нетестовом режиме прайс уйдёт реальным сетям и клиентам. Это реальная отправка писем.',
    testModeDefault: true,
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не сетям)', type: 'boolean', defaultValue: true, description: 'Прайс уйдёт только вам, реальным сетям не уйдёт', required: false },
      { key: 'skip_if_sent', label: 'Не дублировать рассылку', type: 'boolean', defaultValue: true, description: 'Пропустить отправку, если прайс уже уходил сегодня', required: false },
    ],
  },
];

type InputValues = Record<string, Record<string, boolean | string>>;

function defaultInputs(scenario: WorkflowScenario): Record<string, boolean | string> {
  const out: Record<string, boolean | string> = {};
  for (const input of scenario.inputs) out[input.key] = input.defaultValue;
  return out;
}

export function RunProcessesPage() {
  const { user } = useAuth();
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; runUrl?: string | null; status: 'accepted' | 'error' } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<{ id: string; name: string } | null>(null);
  const [inputValues, setInputValues] = useState<InputValues>(() => {
    const init: InputValues = {};
    for (const s of SCENARIOS) init[s.id] = defaultInputs(s);
    return init;
  });

  const apiConfigured = isApiConfigured();

  const setInput = (scenarioId: string, key: string, value: boolean | string) => {
    setInputValues((prev) => ({ ...prev, [scenarioId]: { ...prev[scenarioId], [key]: value } }));
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
    setResult(null);
    if (scenario.warning) {
      setConfirmOpen({ id: scenario.id, name: scenario.name });
      return;
    }
    void executeRun(scenario);
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
    const inputs = inputValues[scenario.id] || {};
    setRunning(scenario.id);
    setResult(null);

    if (!apiConfigured) {
      const message = 'Запуск не настроен: отсутствует серверный API.';
      setResult({ message, status: 'error' });
      await writeLog({ workflowId: scenario.id, workflowName: scenario.name, status: 'error', message, inputs });
      setRunning(null);
      return;
    }

    try {
      const response = await runWorkflow({ workflowId: scenario.id, inputs });
      setResult({ message: response.message, runUrl: response.runUrl ?? null, status: 'accepted' });
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
      setResult({ message, status: 'error' });
      await writeLog({ workflowId: scenario.id, workflowName: scenario.name, status: 'error', message, inputs });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      <h2 className="page-title">Запуск</h2>
      {!apiConfigured && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <strong>Запуск не настроен:</strong> отсутствует серверный API (VITE_API_BASE_URL).
          Сервер должен проверять Firebase ID token, валидировать workflow и параметры по белому списку и вести журнал запусков.
        </div>
      )}
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Запускает разрешённые GitHub Actions workflows через защищённый серверный API. GitHub-токены не хранятся в браузере.
      </p>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr' }}>
        {SCENARIOS.map((scenario) => {
          const values = inputValues[scenario.id] || {};
          return (
            <div key={scenario.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{scenario.name}</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{scenario.description}</p>
                </div>
                <button className="btn btn-primary" onClick={() => handleRunClick(scenario)} disabled={running === scenario.id}>
                  {running === scenario.id ? 'Запуск…' : 'Запустить'}
                </button>
              </div>

              {scenario.warning && (
                <div style={{ marginTop: 10, padding: 8, background: '#fbf4e3', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
                  ⚠️ {scenario.warning}
                </div>
              )}

              {scenario.inputs.length > 0 && (
                <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                  {scenario.inputs.map((input: WorkflowInput) => (
                    <div key={input.key} className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {input.type === 'boolean' ? (
                          <>
                            <input
                              type="checkbox"
                              checked={Boolean(values[input.key])}
                              onChange={(e) => setInput(scenario.id, input.key, e.target.checked)}
                            />
                            <span>{input.label}</span>
                          </>
                        ) : (
                          <span>{input.label}</span>
                        )}
                      </label>
                      {input.type === 'string' && (
                        <input
                          className="form-input"
                          value={String(values[input.key] ?? '')}
                          onChange={(e) => setInput(scenario.id, input.key, e.target.value)}
                          placeholder={input.description}
                        />
                      )}
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{input.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {result && (
        <div className={`alert ${result.status === 'accepted' ? 'alert-info' : 'alert-danger'}`} style={{ marginTop: 16 }}>
          <strong style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.4px' }}>
            {result.status === 'accepted' ? 'Запрос принят' : 'Ошибка'}
          </strong>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>{result.message}</p>
          {result.runUrl && (
            <a href={result.runUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8, display: 'inline-block', fontSize: 13, fontWeight: 500 }}>
              Открыть запуск в GitHub Actions
            </a>
          )}
          <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
            Статус «запрос принят» не означает завершение workflow. История запросов сохраняется в разделе «Отчёты» (при настроенном Firestore).
          </p>
        </div>
      )}

      {confirmOpen && (
        <div className="dialog-overlay" onClick={() => setConfirmOpen(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Подтверждение запуска</div>
            <div className="dialog-body">
              Вы собираетесь запустить <strong>{confirmOpen.name}</strong>.<br />
              {SCENARIOS.find((s) => s.id === confirmOpen.id)?.warning}
              <br /><br />
              <strong>Письма могут уйти реальным получателям.</strong> Продолжить?
            </div>
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={() => setConfirmOpen(null)}>Отмена</button>
              <button className="btn btn-danger" onClick={handleConfirm}>Да, запустить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}