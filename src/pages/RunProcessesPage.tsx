import { useState } from 'react';
import { runWorkflow, isApiConfigured } from '@/api';
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

export function RunProcessesPage() {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; runUrl?: string | null; status: 'accepted' | 'error' } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<{ id: string; name: string } | null>(null);

  const apiConfigured = isApiConfigured();

  const handleRunClick = (scenario: WorkflowScenario) => {
    setResult(null);
    if (scenario.warning) {
      setConfirmOpen({ id: scenario.id, name: scenario.name });
      return;
    }
    executeRun(scenario);
  };

  const handleConfirm = () => {
    if (!confirmOpen) return;
    const scenario = SCENARIOS.find((s) => s.id === confirmOpen!.id);
    if (scenario) {
      setConfirmOpen(null);
      executeRun(scenario);
    }
  };

  const handleCancel = () => {
    setConfirmOpen(null);
  };

  const executeRun = async (scenario: WorkflowScenario) => {
    setRunning(scenario.id);
    setResult(null);

    if (!apiConfigured) {
      setResult({
        message: 'Запуск процессов не настроен: отсутствует серверный API.',
        status: 'error',
      });
      setRunning(null);
      return;
    }

    const builtInputs: Record<string, boolean | string> = {};
    for (const input of scenario.inputs) {
      builtInputs[input.key] = input.defaultValue;
    }

    try {
      const response = await runWorkflow({ workflowId: scenario.id, inputs: builtInputs });
      setResult({
        message: response.message,
        runUrl: response.runUrl ?? null,
        status: 'accepted',
      });
    } catch (err: any) {
      if (err?.isNotConfigured) {
        setResult({ message: err.message, status: 'error' });
      } else {
        setResult({ message: err?.message || 'Неизвестная ошибка при запуске', status: 'error' });
      }
    } finally {
      setRunning(null);
    }
  };

  if (!apiConfigured) {
    return (
      <div className="card">
        <h2 className="card-title">Запуск процессов</h2>
        <div className="alert alert-warning">
          <strong>Запуск процессов не настроен:</strong> отсутствует серверный API.
          Настройте серверный посредник (Firebase Cloud Functions или Cloudflare Worker),
          который вызывает GitHub Actions workflow_dispatch, и укажите адрес в переменной
          окружения VITE_API_BASE_URL. Список разрешённых запусков задаётся только на сервере.
        </div>
        <p style={{ fontSize: 13, color: '#6b7280' }}>
          Доступные сценарии (будут показаны после настройки API):{' '}
          {SCENARIOS.map((s) => s.name).join(', ')}.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Запуск процессов</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Запускает разрешённые GitHub Actions workflows через защищённый серверный API.
        GitHub-токены не хранятся в браузере.
      </p>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr' }}>
        {SCENARIOS.map((scenario) => (
          <div key={scenario.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flexStart', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{scenario.name}</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{scenario.description}</p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => handleRunClick(scenario)}
                disabled={running === scenario.id}
              >
                {running === scenario.id ? 'Запуск…' : 'Запустить'}
              </button>
            </div>
            {scenario.warning && (
              <div style={{ marginTop: 10, padding: 8, background: '#fbf4e3', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
                ⚠️ {scenario.warning}
              </div>
            )}
            {scenario.inputs.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                Параметры: {scenario.inputs.map((i: WorkflowInput) => i.label).join(', ')}.
              </div>
            )}
          </div>
        ))}
      </div>

      {result && (
        <div className={`alert ${result.status === 'accepted' ? 'alert-info' : 'alert-danger'}`}>
          <strong style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.4px' }}>
            {result.status === 'accepted' ? 'Запрос принят' : 'Ошибка'}
          </strong>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>{result.message}</p>
          {result.runUrl && (
            <a href={result.runUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8, fontSize: 13, fontWeight: 500 }}>
              Открыть запуск в GitHub Actions
            </a>
          )}
          <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
            Статус «запрос принят» не означает завершение workflow. Отслеживайте ход выполнения
            по ссылке в GitHub Actions.
          </p>
        </div>
      )}

      {confirmOpen && (
        <div className="dialog-overlay" onClick={handleCancel}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Подтверждение запуска</div>
            <div className="dialog-body">
              Вы собираетесь запустить <strong>{confirmOpen.name}</strong>.<br />
              {SCENARIOS.find((s) => s.id === confirmOpen.id)?.warning}
              <br /><br />
              <strong>Письма могут уйти реальным получателям.</strong> Продолжить?
            </div>
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={handleCancel}>Отмена</button>
              <button className="btn btn-danger" onClick={handleConfirm}>
                Да, запустить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}