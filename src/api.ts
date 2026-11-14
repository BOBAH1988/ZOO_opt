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

import { auth } from '@/firebase';

// Базовый URL серверного API. Настраивается через переменную окружения.
// Завершающий слеш удаляется, чтобы избежать двойного //run.
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export interface RunWorkflowRequest {
  workflowId: string;
  inputs: Record<string, boolean | string>;
}

export interface RunWorkflowResponse {
  accepted: boolean;
  message: string;
  runUrl?: string | null;
  runId?: string | null;
  logId?: string | null;
}

export interface ApiError extends Error {
  status?: number;
  isNotConfigured?: boolean;
  isUnauthorized?: boolean;
}

export class ApiNotConfiguredError extends Error {
  isNotConfigured = true;
  constructor(message = 'Серверный API не настроен') {
    super(message);
    this.name = 'ApiNotConfiguredError';
  }
}

export class ApiUnauthorizedError extends Error {
  isUnauthorized = true;
  constructor(message = 'Требуется авторизация') {
    super(message);
    this.name = 'ApiUnauthorizedError';
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

export async function runWorkflow(
  request: RunWorkflowRequest,
): Promise<RunWorkflowResponse> {
  if (!API_BASE_URL) {
    throw new ApiNotConfiguredError('Запуск не настроен: отсутствует серверный API');
  }

  const user = auth?.currentUser;
  if (!user) {
    throw new ApiUnauthorizedError('Войдите в систему, чтобы запускать процессы');
  }

  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      const timeoutErr = new Error(`Ошибка сервера: превышено время ожидания (${REQUEST_TIMEOUT_MS / 1000} с)`) as ApiError;
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      detail = body.message || body.error || detail;
    } catch {
      // Тело не JSON — оставляем текстовый статус.
    }
    const err = new Error(`Ошибка сервера: ${detail}`) as ApiError;
    err.status = response.status;
    throw err;
  }

  let body: RunWorkflowResponse;
  try {
    body = (await response.json()) as RunWorkflowResponse;
  } catch {
    const err = new Error('Ошибка сервера: неверный формат ответа') as ApiError;
    err.status = 502;
    throw err;
  }

  if (!body.accepted) {
    const err = new Error(body.message || 'Сервер не принял запрос на запуск') as ApiError;
    err.status = 400;
    throw err;
  }

  return body;
}

export function isApiConfigured(): boolean {
  return Boolean(API_BASE_URL);
}

// Белый список workflow хранится только на сервере (server/index.js, server/cloudflare/src/index.js).
// Клиент не хранит дубликат, чтобы списки не расходились.
