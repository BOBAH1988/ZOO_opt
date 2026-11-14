import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export const ALLOWED_WORKFLOWS = {
  tests: { file: 'tests.yml', inputs: {} },
  kpi_sales: { file: 'kpi_sales.yml', inputs: {} },
  weekly_fri: {
    file: 'weekly_fri.yml',
    inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' },
    realSendGuard: true,
  },
  weekly_mon_tue: {
    file: 'weekly_mon_tue.yml',
    inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' },
    realSendGuard: true,
  },
  weekly_wed: {
    file: 'weekly_wed.yml',
    inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' },
    realSendGuard: true,
  },
  weekly_residues: {
    file: 'weekly_residues.yml',
    inputs: { test_mode: 'boolean' },
    realSendGuard: true,
  },
  weekly_sety_price: {
    file: 'weekly_sety_price.yml',
    inputs: { test_mode: 'boolean', skip_if_sent: 'boolean' },
    realSendGuard: true,
  },
  weekly_tue: {
    file: 'weekly_tue.yml',
    inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' },
    realSendGuard: true,
  },
};

const MAX_BODY_BYTES = 16 * 1024;

export function validateWorkflowRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be an object' };
  }

  if (typeof body.workflowId !== 'string' || !ALLOWED_WORKFLOWS[body.workflowId]) {
    return { ok: false, error: 'Workflow is not allowed' };
  }

  const inputs = body.inputs ?? {};
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return { ok: false, error: 'inputs must be an object' };
  }

  const workflow = ALLOWED_WORKFLOWS[body.workflowId];
  const cleaned = {};
  for (const [key, value] of Object.entries(inputs)) {
    const expectedType = workflow.inputs[key];
    if (!expectedType) return { ok: false, error: `Unknown input: ${key}` };
    if (typeof value !== expectedType) return { ok: false, error: `${key} must be ${expectedType}` };
    if (typeof value === 'string' && value.length > 100) {
      return { ok: false, error: `${key} is too long` };
    }
    cleaned[key] = value;
  }

  if (workflow.realSendGuard && typeof cleaned.test_mode !== 'boolean') {
    return { ok: false, error: 'test_mode must be boolean' };
  }

  return { ok: true, workflowId: body.workflowId, workflow, inputs: cleaned };
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

async function authenticate(request, projectId) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!match) return null;

  try {
    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

async function dispatchWorkflow(env, workflow, inputs) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflow.file}/dispatches`;
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
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(JSON.stringify({
      type: 'github_dispatch_failed',
      status: response.status,
      workflow: workflow.file,
      body: text,
    }));
    throw new Error(`GitHub rejected the workflow dispatch request (${response.status})`);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      if (origin !== env.APP_ORIGIN) {
        return new Response(null, { status: 403, headers: corsHeaders(origin, env) });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (origin && origin !== env.APP_ORIGIN) {
      return jsonResponse({ message: 'Origin is not allowed' }, 403, origin, env);
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

    const uid = await authenticate(request, env.FIREBASE_PROJECT_ID);
    if (!uid) {
      return jsonResponse({ message: 'Invalid or missing Firebase ID token' }, 401, origin, env);
    }
    if (!allowedUids.includes(uid)) {
      return jsonResponse({ message: 'User is not allowed to run workflows' }, 403, origin, env);
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
      console.log(JSON.stringify({
        type: validation.inputs.test_mode === false ? 'real_send_failed' : 'workflow_dispatch_failed',
        uid,
        workflowId: validation.workflowId,
        error: message,
      }));
      return jsonResponse({ message }, 502, origin, env);
    }

    return jsonResponse({
      accepted: true,
      message: 'Запрос на запуск принят сервером и передан в GitHub Actions.',
      runUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${validation.workflow.file}`,
      runId: null,
    }, 200, origin, env);
  },
};
