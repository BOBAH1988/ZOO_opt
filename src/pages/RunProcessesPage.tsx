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
    description: 'Группа понедельник–вторник. Лемур (Прусакова): проверка письма от zookingdom@mail.ru с прайсом, конвертация .xls→.xlsx, раскраска и рассылка клиентам. Ухта: проверка прайса, конвертация, удаление строк «Мит Гарден», рассылка. Заказ Прусакова оператору: пересылка заказов от zoo2017ukhta@yandex.ru на zookingdom@mail.ru. Дебиторка Ухта: разбор файла задолженности, отчёт по просрочкам. Счета клиентам по списку: пересылка Excel-вложений получателям по ключам тем. Платёжки клиентов оператору: пересылка вложений Excel/PDF от 4 клиентов оператору zookingdom@mail.ru.',
    warning: 'Реальная рассылка клиентам. Тестовый режим включён по умолчанию.',
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: true, description: '', required: false },
      { key: 'only', label: 'Проекты для запуска', type: 'multiselect', defaultValue: [], description: 'Пусто = вся группа', required: false, options: PROJECT_OPTIONS },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'weekly_residues',
    name: 'Рекомендации к заказу по остаткам',
    day: 'пн',
    time: '10:00',
    description: 'Проект 13. Сверяет полный прайс с остатком на складе и продажами за три месяца, собирает список того, что заказать. Считает автоматически и показывает только проверяемые цифры. Запускает пакет residues и присылает результат на почту.',
    warning: 'Реальная рассылка на почту. Тестовый режим включён по умолчанию.',
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам)', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'weekly_sety_price',
    name: 'Прайсы Сети + ИП Мамедов',
    day: 'пн',
    time: '9:00',
    description: 'Проект 3 (Сети Ухта). Рассылка готового файла прайса по списку получателей (scripts/recipients_sety_ukhta.txt). Файл прайса хранится в репозитории и заменяется вручную. Защита от дубля: не отправляет тот же файл повторно в день. Тестовый режим — письмо только вам, тема с префиксом [ТЕСТ].',
    warning: 'Реальная рассылка прайса получателям списка. Тестовый режим включён по умолчанию.',
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не сетям)', type: 'boolean', defaultValue: true, description: '', required: false },
      { key: 'skip_if_sent', label: 'Не дублировать рассылку', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'weekly_tue',
    name: 'Прайс Ухта, счета, платежки',
    day: 'вт',
    time: '9:00',
    description: 'Группа вторник. Прайс Ухта: проверка, конвертация, раскраска и рассылка клиентам. Счета клиентам по списку: пересылка Excel-вложений получателям по ключам тем. Платёжки клиентов оператору: пересылка вложений Excel/PDF от 4 клиентов оператору zookingdom@mail.ru.',
    warning: 'Реальная рассылка клиентам и оператору. Тестовый режим включён по умолчанию.',
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: true, description: '', required: false },
      { key: 'only', label: 'Проекты для запуска', type: 'multiselect', defaultValue: [], description: 'Пусто = вся группа', required: false, options: PROJECT_OPTIONS },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'weekly_wed',
    name: 'Счета Велес и Прусакова',
    day: 'ср',
    time: '14:00',
    description: 'Группа среда. Счёт Прусакова клиенту: поиск непрочитанного письма от zookingdom@mail.ru с темой «Прусакова», пересылка всех Excel-вложений клиенту zoo2017ukhta@yandex.ru, автоотправка только с 13:00 до 14:30. Счета в Велес: пересылка писем от a_tarakashkin@mail.ru с Excel-вложениями получателю iruya@mail.ru.',
    warning: 'Реальная пересылка писем и счетов получателей. Тестовый режим включён по умолчанию.',
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: true, description: '', required: false },
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
    description: 'Группа пятница. Лемур (Прусакова): проверка письма от zookingdom@mail.ru с прайсом, конвертация, раскраска и рассылка клиентам. Дебиторка / ДЗ: проверка письма от yuriy.novikov1980@mail.ru с темой «ДЗ» и Excel-вложением, поиск совпадений по списку клиентов, ответ о задолженности или уведомление «У моих клиентов нет такой задолженности».',
    warning: 'Реальная рассылка клиентам и ответы по дебиторке. Тестовый режим включён по умолчанию.',
    inputs: [
      { key: 'test_mode', label: 'Тестовый режим (только вам, не клиентам)', type: 'boolean', defaultValue: true, description: '', required: false },
      { key: 'only', label: 'Проекты для запуска', type: 'multiselect', defaultValue: [], description: 'Пусто = вся группа', required: false, options: PROJECT_OPTIONS },
      { key: 'ignore_window', label: 'Игнорировать время и день недели', type: 'boolean', defaultValue: true, description: '', required: false },
    ],
  },
  {
    id: 'kpi_sales',
    name: 'KPI Продажи',
    day: '',
    description: 'Проект 12. Личный мотивационный отчёт Владимира Соколова (Ухта) по выполнению плана направлений. Разбирает файл «Проекция объема продаж.xlsx», считает достижение ступеней мотивации, начисления и проекцию. Письмо с темой «Выполнение KPI» уходит только на NOTIFY_EMAIL.',
    warning: 'Реальное письмо на NOTIFY_EMAIL.',
    inputs: [],
  },
];

const ALL_SCRIPTS = [
  {
    id: 'lemur',
    name: 'Лемур — прайс Прусакова',
    description: 'Проверяет почту zookingdom@mail.ru на письмо с темой "Прайс Прусакова.xls", конвертирует .xls→.xlsx, раскрашивает (новинки — зелёным, акции — жёлтым) и рассылает клиентам. Если письма нет к 9:30 — напоминание поставщику, к 10:00 — уведомление на личный email.',
    schedule: 'пн, пт — 07:37–10:07 МСК',
  },
  {
    id: 'ukhta',
    name: 'Ухта — прайс',
    description: 'Проверяет почту на письмо с темой "прайс Ухта.xls", конвертирует .xls→.xlsx, удаляет строки "Мит Гарден", рассылает клиентам. Получатели в scripts/recipients_ukhta.txt. Есть тестовый режим.',
    schedule: 'пн, вт — 07:36–10:06 МСК',
  },
  {
    id: 'sety',
    name: 'Сети Ухта — прайс',
    description: 'Рассылает готовый файл прайса из репозитория по списку получателей (scripts/recipients_sety_ukhta.txt). Защита от дубля: не отправляет тот же файл повторно в день. Тема: "Здравствуйте, прайс от ООО "ЗОО Логистик"".',
    schedule: 'пн — в любое время (слот дня)',
  },
  {
    id: 'order',
    name: 'Заказ Прусакова оператору',
    description: 'Пересылает заказы клиента zoo2017ukhta@yandex.ru оператору zookingdom@mail.ru. Классифицирует темы: заказ, корректировка, доп.заказ, игнорирует "ЗАКАЗ АММА". Уведомляет о комментариях к заказу.',
    schedule: 'пн — 07:00–11:30 МСК',
  },
  {
    id: 'invoice',
    name: 'Счёт Прусакова клиенту',
    description: 'Ищет письмо от zookingdom@mail.ru с темой "Прусакова", пересылает все Excel-вложения клиенту zoo2017ukhta@yandex.ru. Автоотправка только с 13:00 до 14:30, после — уведомление "отправьте вручную".',
    schedule: 'ср — 09:05–15:35 МСК',
  },
  {
    id: 'veles',
    name: 'Счета в Велес',
    description: 'Пересылает письма от a_tarakashkin@mail.ru с Excel-вложениями получателю iruya@mail.ru с темой "Счет от Зоо Логистик". Письма без вложений пропускаются.',
    schedule: 'ср — 14:30–16:00 МСК',
  },
  {
    id: 'dz',
    name: 'Ответ по дебиторке / ДЗ',
    description: 'Проверяет письмо от yuriy.novikov1980@mail.ru с темой "ДЗ" и Excel-вложением, ищет совпадения по списку клиентов. Отвечает "нет задолженности" или шлёт вам письмо "Разобраться с дебеторкой" с суммами.',
    schedule: 'пт — 08:00–09:30 МСК',
  },
  {
    id: 'veta',
    name: 'Счёт ВЕТА ООО клиенту',
    description: 'Ищет письмо от zookingdom@mail.ru с темой "ВЕТА ООО Ухта Заводская 3.xls", пересылает Excel-вложение получателю popovse1959@mail.ru.',
    schedule: 'пн — 08:12–11:12 МСК',
  },
  {
    id: 'clients',
    name: 'Счета клиентам по списку',
    description: 'Пересылает Excel-вложения из писем от zookingdom@mail.ru получателям по ключам тем (8 клиентов). Уведомляет "Счет отправлен клиенту <Имя>".',
    schedule: 'пн, вт — 09:24–17:24 МСК',
  },
  {
    id: 'debt_ukhta',
    name: 'Дебиторка Ухта',
    description: 'Разбирает файл задолженности от поставщика, присылает отчёт по просроченным накладным (сумма ≥ 1000 — уведомление клиенту, ≤ -100 — уведомление о переплате). Если письма нет к 11:00 — напоминание оператору "Вышлите дебеторку Ухта".',
    schedule: 'пн — 07:18–11:18 МСК',
  },
  {
    id: 'payments',
    name: 'Платёжки клиентов оператору',
    description: 'Пересылает вложения Excel/PDF от 4 клиентов (Солодовник, Прусакова, ООО "Вета", Смирнов) оператору zookingdom@mail.ru с темой "Платежка от <Имя>". Уведомляет об успешной передаче.',
    schedule: 'пн, вт — 10:27–17:27 МСК',
  },
  {
    id: 'kpi',
    name: 'KPI «Продажи»',
    description: 'Личный мотивационный отчёт Владимира Соколова (Ухта). Разбирает файл "Проекция объема продаж.xlsx", считает достижение ступеней мотивации, начисления и проекцию. Письмо уходит только на NOTIFY_EMAIL.',
    schedule: 'будни — 14:05 МСК',
  },
  {
    id: 'residues',
    name: 'Рекомендации к заказу по остаткам',
    description: 'Сверяет полный прайс с остатком на складе и продажами за три месяца, собирает список того, что заказать. Запускает пакет residues и присылает результат на почту.',
    schedule: 'пн — 10:00 МСК',
  },
];

type InputValues = Record<string, Record<string, boolean | string | string[]>>;

const SETTINGS_VERSION = 3;
const STORAGE_KEY = 'zoo-opt-run-settings';

function defaultInputs(scenario: WorkflowScenario): Record<string, boolean | string | string[]> {
  const out: Record<string, boolean | string | string[]> = {};
  for (const input of scenario.inputs) out[input.key] = input.defaultValue;
  return out;
}

function loadSettings(): InputValues {
  const init: InputValues = {};
  for (const s of SCENARIOS) init[s.id] = defaultInputs(s);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { version?: number; values?: InputValues };
      if (parsed.version === SETTINGS_VERSION && parsed.values) {
        for (const s of SCENARIOS) {
          if (parsed.values[s.id]) {
            init[s.id] = { ...init[s.id], ...parsed.values[s.id] };
          }
        }
      }
    }
  } catch {
    // игнорируем ошибки чтения localStorage
  }
  return init;
}

export function RunProcessesPage() {
  const { user } = useAuth();
  const [running, setRunning] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<{ id: string; name: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<WorkflowScenario | null>(null);
  const [openMultiselect, setOpenMultiselect] = useState<Record<string, boolean>>({});
  const [runStatus, setRunStatus] = useState<Record<string, { status: 'ok' | 'error'; message?: string }>>({});
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [inputValues, setInputValues] = useState<InputValues>(loadSettings);

  const apiConfigured = isApiConfigured();

  // Сохраняем настройки при каждом изменении
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, values: inputValues }));
    } catch {
      // игнорируем ошибки записи localStorage
    }
  }, [inputValues]);

  // Закрыть help-меню при клике снаружи
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (helpMenuOpen && target && !target.closest('.help-menu')) {
        setHelpMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [helpMenuOpen]);

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
    // Сбрасываем статус запуска при изменении настроек, чтобы кнопка «Запустить» снова стала доступна.
    setRunStatus((prev) => {
      const next = { ...prev };
      delete next[scenarioId];
      return next;
    });
  };

  const resetSettings = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // игнорируем ошибки очистки localStorage
    }
    setInputValues(loadSettings());
    // Сброс настроек должен вернуть кнопку «Запустить» для всех сценариев.
    setRunStatus({});
  };

  const toggleMultiselect = (scenarioId: string, key: string, value: string) => {
    setInputValues((prev) => {
      const cur = (prev[scenarioId]?.[key] as string[] | undefined) || [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [scenarioId]: { ...prev[scenarioId], [key]: next } };
    });
    // Смена множественного выбора должна вернуть кнопку «Запустить».
    setRunStatus((prev) => {
      const next = { ...prev };
      delete next[scenarioId];
      return next;
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
      setRunStatus((prev) => ({ ...prev, [scenario.id]: { status: 'ok', message: response.message } }));
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
      setRunStatus((prev) => ({ ...prev, [scenario.id]: { status: 'error', message } }));
      await writeLog({ workflowId: scenario.id, workflowName: scenario.name, status: 'error', message, inputs });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className="page-title" style={{ margin: 0 }}>{'Запуск'}</h2>
        <button
          onClick={() => setHelpMenuOpen((prev) => !prev)}
          style={{
            background: 'transparent',
            border: '1px solid #94a3b8',
            borderRadius: 6,
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 22,
            fontWeight: 700,
            color: '#64748b',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
            e.currentTarget.style.background = isDark ? '#1e3a5f' : '#f8fafc';
            e.currentTarget.style.color = isDark ? '#ffffff' : '#475569';
          }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}
        >
          ❓
        </button>
      </div>

      {helpMenuOpen && (
        <div className="help-menu"
          style={{
            position: 'fixed',
            top: 80,
            right: 16,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            padding: 12,
            minWidth: 280,
            maxWidth: '90vw',
            maxHeight: '75vh',
            overflowY: 'auto',
            zIndex: 50,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setHelpMenuOpen(false)}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8, borderBottom: '1px solid var(--color-border)', paddingBottom: 6 }}>
            Сценарии запуска
          </div>
          {SCENARIOS.map((scenario) => (
            <div
              key={scenario.id}
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--color-border)',
                cursor: 'default',
                fontSize: 12.5,
                color: 'var(--color-text)',
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>{scenario.name}</div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 11.5, overflowWrap: 'anywhere' }}>{scenario.description}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>Код скрипта: {scenario.id}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>·</span>
                <span>{scenario.day}{scenario.time ? ` в ${scenario.time}` : ''}</span>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginTop: 14, marginBottom: 8, borderBottom: '1px solid var(--color-border)', paddingBottom: 6 }}>
            Все скрипты
          </div>
          {ALL_SCRIPTS.map((script) => (
            <div
              key={script.id}
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--color-border)',
                cursor: 'default',
                fontSize: 12.5,
                color: 'var(--color-text)',
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>{script.name}</div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 11.5, overflowWrap: 'anywhere' }}>{script.description}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>Код скрипта: {script.id}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>·</span>
                <span>{script.schedule}</span>
              </div>
            </div>
          ))}
        </div>
      )}

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
              {runStatus[scenario.id]?.status === 'ok' ? (
                <span className="btn btn-success" style={{ width: '100%', padding: '6px 10px', fontSize: 13, textAlign: 'center', display: 'block' }}>Ок</span>
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
                  width: 32,
                  height: 32,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  lineHeight: 1,
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
              {runStatus[scenario.id]?.status === 'error' && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, padding: 6, background: '#fee2e2', borderRadius: 6, fontSize: 11, color: '#991b1b', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>Сбой: {runStatus[scenario.id]?.message}</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(runStatus[scenario.id]?.message || '').catch(() => {
                        // Копирование не критично для работы приложения
                      });
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid #dc2626',
                      color: '#dc2626',
                      borderRadius: 4,
                      width: 24,
                      height: 24,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: 0,
                    }}
                    title="Скопировать ошибку"
                  >
                    📋
                  </button>
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
              <br />
              Текущий режим: <strong>{(inputValues[confirmOpen.id]?.test_mode ?? true) ? 'тестовый (только вам)' : 'реальный — клиентам!'}</strong>.
            </div>
            {(() => {
              const scenario = SCENARIOS.find((s) => s.id === confirmOpen?.id);
              if (scenario?.warning) {
                return (
                  <div style={{ gridColumn: '1 / -1', padding: 6, background: '#fbf4e3', borderRadius: 6, fontSize: 11, color: '#92400e', overflowWrap: 'anywhere', wordBreak: 'break-word', marginTop: 8 }}>
                    ⚠️ {scenario.warning}
                  </div>
                );
              }
              return null;
            })()}
            <div className="dialog-actions">
              <button className="btn btn-success" onClick={handleConfirm}>Да</button>
              <button className="btn btn-danger" onClick={() => setConfirmOpen(null)}>Нет</button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="dialog-overlay" onClick={() => setSettingsOpen(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
            <button
              onClick={() => setSettingsOpen(null)}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'transparent',
                border: 'none',
                fontSize: 20,
                color: '#ef4444',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
              }}
            >
              ×
            </button>
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
              <button className="btn btn-outline" onClick={resetSettings}>Сброс к настройкам по умолчанию</button>
              <button className="btn btn-outline" onClick={() => setSettingsOpen(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
