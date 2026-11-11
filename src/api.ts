/**
 * API-контракт с серверным посредником для запуска GitHub Actions workflows.
 *
 * Реализация на стороне сервера (Firebase Cloud Functions / Cloudflare Worker /
 * ваш собственный API) должна принимать запросы от этого клиента, проверять
 * права пользователя, валидировать workflowId и параметры по «белому списку»
 * (разрешённые запуски задаются только на сервере), и вызывать
 * GitHub API workflow_dispatch с секретным токеном, хранящимся на сервере.
 *
 * Никаких GitHub-токенов или секретов не передаётся из браузера.
 */

// Базовый URL серверного API. Настраивается через переменную окружения или
// файл конфигурации. Пустая строка = API не настроен.
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || '';

// Разрешённые workflow — дублируются здесь только для отображения в UI.
// На сервере должен быть свой независимый белый список с такими же идентификаторами.
export const ALLOWED_WORKFLOWS: Record<string, { name: string; path: string }> = {
  kpi_sales: {
    name: 'KPI Продажи (ручной запуск)',
    path: '.github/workflows/kpi_sales.yml',
  },
  tests: {
    name: 'Тесты (стенд)',
    path: '.github/workflows/tests.yml',
  },
  weekly_fri: {
    name: 'Почта пятница',
    path: '.github/workflows/weekly_fri.yml',
  },
  weekly_mon_tue: {
    name: 'Почта понедельник-вторник',
    path: '.github/workflows/weekly_mon_tue.yml',
  },
  weekly_residues: {
    name: 'Рекомендации к заказу (понедельник)',
    path: '.github/workflows/weekly_residues.yml',
  },
  weekly_sety_price: {
    name: 'Прайсы понедельника (сети + ИП Мамедов)',
    path: '.github/workflows/weekly_sety_price.yml',
  },
  weekly_wed: {
    name: 'Почта среда',
    path: '.github/workflows/weekly_wed.yml',
  },
};

export interface RunWorkflowRequest {
  workflowId: string;
  inputs: Record<string, boolean | string>;
}

export interface RunWorkflowResponse {
  accepted: boolean;
  message: string;
  runUrl?: string | null;
  runId?: string | null;
}

export interface ApiError extends Error {
  status?: number;
  isNotConfigured?: boolean;
}

export class ApiNotConfiguredError extends Error {
  isNotConfigured = true;
  constructor(message = 'Серверный API не настроен') {
    super(message);
    this.name = 'ApiNotConfiguredError';
  }
}

export async function runWorkflow(
  request: RunWorkflowRequest,
): Promise<RunWorkflowResponse> {
  if (!API_BASE_URL) {
    throw new ApiNotConfiguredError(
      'Запуск процессов не настроен: отсутствует серверный API',
    );
  }

  const response = await fetch(`${API_BASE_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const err = new Error(
      `Ошибка сервера: ${response.status} ${response.statusText}`,
    ) as ApiError;
    err.status = response.status;
    throw err;
  }

  return (await response.json()) as RunWorkflowResponse;
}

export function isApiConfigured(): boolean {
  return Boolean(API_BASE_URL);
}