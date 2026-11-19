import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

// Правила запуска — общий модуль для Express и Worker: server/shared/workflows.js.
// Импорт по относительному пути, чтобы wrangler собирал один файл без копии.
import {
  ALLOWED_WORKFLOWS,
  PROJECT_ALLOWLIST,
  validateWorkflowInputs,
} from '../../shared/workflows.js';

export { ALLOWED_WORKFLOWS, PROJECT_ALLOWLIST };

const MAX_BODY_BYTES = 16 * 1024;

/** Прежний контракт тестов: { ok, inputs } либо { ok, error }. */
export function validateWorkflowRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be an object' };
  }

  const result = validateWorkflowInputs(body.workflowId, body.inputs ?? {});
  if (!result.ok) return result;

  return { ok: true, workflowId: body.workflowId, workflow: result.workflow, inputs: result.cleaned };
}

function corsHeaders(origin, env) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  if (origin && origin === env.APP_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}

function jsonResponse(body, status, origin, env) {
  const headers = corsHeaders(origin, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function parseUidList(value) {
  return (value || '').split(',').map((uid) => uid.trim()).filter(Boolean);
}

// Результат аутентификации: uid | 'missing_token' | 'unverified_email' | 'invalid_token'
async function authenticate(request, projectId) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!match) return 'missing_token';

  try {
    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });
    if (payload.email_verified !== true) return 'unverified_email';
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : 'invalid_token';
  } catch {
    return 'invalid_token';
  }
}

const GITHUB_FETCH_TIMEOUT_MS = 15_000;

// Безопасные коды причин для клиента (внутренний текст GitHub не отдаём).
function githubErrorCode(status) {
  if (status === 401) return 'github_auth_failed';
  if (status === 403) return 'github_forbidden';
  if (status === 404) return 'github_not_found';
  return 'github_dispatch_failed';
}

async function dispatchWorkflow(env, workflow, inputs) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflow.path}/dispatches`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'zoo-opt-run-api',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: Object.fromEntries(
          Object.entries(inputs).map(([key, value]) => [key, String(value)]),
        ),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(JSON.stringify({
        type: 'github_dispatch_failed',
        status: response.status,
        workflow: workflow.path,
        body: text,
      }));
      const err = new Error(`GitHub rejected the workflow dispatch request (${response.status})`);
      err.code = githubErrorCode(response.status);
      throw err;
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      const timeoutErr = new Error('GitHub request timed out');
      timeoutErr.code = 'github_timeout';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      if (origin && origin !== env.APP_ORIGIN) {
        // Для чужого origin не отдаём ACAO — браузер заблокирует preflight.
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (origin && origin !== env.APP_ORIGIN) {
      // Не эхо-ем чужой origin в ACAO — иначе любой сайт сможет прочитать ответ.
      // Браузер заблокирует ответ из-за отсутствия совпадающего ACAO.
      return new Response(JSON.stringify({ message: 'Origin is not allowed' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ ok: true }, 200, origin, env);
    }

    if (pathname !== '/run' || request.method !== 'POST') {
      return jsonResponse({ message: 'Not found' }, 404, origin, env);
    }

    const allowedUids = parseUidList(env.ALLOWED_UIDS);
    if (!env.FIREBASE_PROJECT_ID || !env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_TOKEN || allowedUids.length === 0) {
      return jsonResponse({ message: 'Server is not configured' }, 503, origin, env);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ message: 'Request body is too large' }, 413, origin, env);
    }

    if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
      return jsonResponse({ message: 'Content-Type must be application/json' }, 415, origin, env);
    }

    const authResult = await authenticate(request, env.FIREBASE_PROJECT_ID);
    if (authResult === 'missing_token') {
      return jsonResponse({ message: 'Требуется токен авторизации Firebase', code: 'missing_token' }, 401, origin, env);
    }
    if (authResult === 'unverified_email') {
      return jsonResponse({ message: 'Email не подтверждён. Подтвердите почту в Firebase Auth.', code: 'unverified_email' }, 403, origin, env);
    }
    // Истёкший или повреждённый токен — 401: клиенту нужно перелогиниться,
    // это отличается от «нет прав» (403).
    if (authResult === 'invalid_token' || !authResult) {
      return jsonResponse({ message: 'Сессия истекла. Войдите заново.', code: 'invalid_token' }, 401, origin, env);
    }
    const uid = authResult;
    if (!allowedUids.includes(uid)) {
      return jsonResponse({ message: 'User is not allowed to run workflows', code: 'uid_not_allowed' }, 403, origin, env);
    }

    let body;
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ message: 'Request body is too large' }, 413, origin, env);
      }
      body = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ message: 'Invalid JSON body' }, 400, origin, env);
    }

    const validation = validateWorkflowRequest(body);
    if (!validation.ok) {
      return jsonResponse({ message: validation.error }, 400, origin, env);
    }

    if (
      validation.workflow.realSendGuard &&
      validation.inputs.test_mode === false &&
      !parseUidList(env.REAL_SEND_UIDS).includes(uid)
    ) {
      return jsonResponse({ message: 'Real email sending is not enabled for this account' }, 403, origin, env);
    }

    console.log(JSON.stringify({
      type: validation.inputs.test_mode === false ? 'real_send_requested' : 'workflow_dispatch_requested',
      uid,
      workflowId: validation.workflowId,
    }));

    try {
      await dispatchWorkflow(env, validation.workflow, validation.inputs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to dispatch GitHub Actions workflow';
      const code = err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'github_dispatch_failed';
      console.log(JSON.stringify({
        type: validation.inputs.test_mode === false ? 'real_send_failed' : 'workflow_dispatch_failed',
        uid,
        workflowId: validation.workflowId,
        error: message,
      }));
      // Клиенту — код причины и статус; текст GitHub не отдаём.
      const status = code === 'github_auth_failed' ? 502
        : code === 'github_forbidden' ? 502
        : code === 'github_not_found' ? 502
        : code === 'github_timeout' ? 504
        : 502;
      return jsonResponse({ message: code, code }, status, origin, env);
    }

    return jsonResponse({
      accepted: true,
      message: 'Запрос на запуск принят сервером и передан в GitHub Actions.',
      runUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${validation.workflow.path}`,
      runId: null,
    }, 200, origin, env);
  },
};
