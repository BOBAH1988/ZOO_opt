import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Секреты (GITHUB_TOKEN, FIREBASE_PRIVATE_KEY) держим вне папки репозитория:
// иначе бэкап или архив рабочей папки уносит их вместе с кодом.
// Порядок поиска: ZOO_SERVER_ENV -> ~/.config/zoo-opt/server.env
//                -> server/.env (старый путь, поддержан для совместимости).
const envCandidates = [
  process.env.ZOO_SERVER_ENV,
  path.join(os.homedir(), '.config', 'zoo-opt', 'server.env'),
  path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
].filter(Boolean);

for (const candidate of envCandidates) {
  const result = dotenv.config({ path: candidate });
  if (!result.error) break;
}

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import admin from 'firebase-admin';
import { pathToFileURL } from 'node:url';
import { ALLOWED_WORKFLOWS, PROJECT_ALLOWLIST, validateWorkflowInputs } from './shared/workflows.js';

const PORT = process.env.PORT || 8787;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'BOBAH1988';
const GITHUB_REPO = process.env.GITHUB_REPO || 'ZOO_opt';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const ALLOWED_UIDS = (process.env.ALLOWED_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const REAL_SEND_UIDS = (process.env.REAL_SEND_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const APP_ORIGIN = process.env.APP_ORIGIN || '';

export { ALLOWED_WORKFLOWS, PROJECT_ALLOWLIST } from './shared/workflows.js';

function initFirebaseAdmin() {
  if (admin.apps.length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) privateKey = privateKey.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin env vars are required');
  admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

function logEvent(event) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

/** Обёртка над общей валидацией: оставляет прежний контракт { ok, cleaned }. */
export function validateInputs(workflowId, inputs) {
  const result = validateWorkflowInputs(workflowId, inputs);
  return result.ok
    ? { ok: true, cleaned: result.cleaned }
    : { ok: false, error: result.error };
}

const GITHUB_FETCH_TIMEOUT_MS = 15_000;

async function dispatchWorkflow(workflowId, inputs) {
  const spec = ALLOWED_WORKFLOWS[workflowId];
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${spec.path}/dispatches`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'zoo-opt-run-api',
      },
      body: JSON.stringify({ ref: 'main', inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v)])) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub dispatch failed: ${res.status} ${text}`);
    }
    return { accepted: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

const app = express();
app.use(cors({
  origin: APP_ORIGIN ? APP_ORIGIN : false,
}));
app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/run', async (req, res) => {
  const requestId = crypto.randomUUID();
  try {
    initFirebaseAdmin();
    if (!GITHUB_TOKEN) return res.status(503).json({ message: 'Server is not configured (missing GITHUB_TOKEN)' });

    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ message: 'Требуется токен авторизации Firebase', code: 'missing_token' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(match[1], true);
    } catch {
      // Истёкший/повреждённый токен — 401: клиенту нужно перелогиниться.
      return res.status(401).json({ message: 'Сессия истекла. Войдите заново.', code: 'invalid_token' });
    }
    const uid = decoded.uid;
    const email = decoded.email || null;
    if (!decoded.email_verified) {
      logEvent({ level: 'warn', type: 'email_not_verified', requestId, uid, email });
      return res.status(403).json({ message: 'Email не подтверждён. Подтвердите почту в Firebase Auth.', code: 'unverified_email' });
    }
    if (ALLOWED_UIDS.length === 0 || !ALLOWED_UIDS.includes(uid)) {
      logEvent({ level: 'warn', type: 'forbidden_uid', requestId, uid });
      return res.status(403).json({ message: 'User is not allowed to run workflows', code: 'uid_not_allowed' });
    }

    const { workflowId, inputs } = req.body || {};
    if (typeof workflowId !== 'string' || !ALLOWED_WORKFLOWS[workflowId]) {
      return res.status(400).json({ message: 'Workflow is not allowed' });
    }

    const validation = validateInputs(workflowId, inputs || {});
    if (!validation.ok) return res.status(400).json({ message: validation.error });

    const spec = ALLOWED_WORKFLOWS[workflowId];

    if (spec.realSendGuard) {
      if (typeof validation.cleaned.test_mode !== 'boolean') {
        return res.status(400).json({ message: 'test_mode must be boolean' });
      }
      if (
        validation.cleaned.test_mode === false &&
        (REAL_SEND_UIDS.length === 0 || !REAL_SEND_UIDS.includes(uid))
      ) {
        logEvent({ level: 'warn', type: 'real_send_forbidden', requestId, uid, workflowId });
        return res.status(403).json({ message: 'Real email sending is not enabled for this account' });
      }
    }

    logEvent({ level: 'info', type: 'run_request', requestId, uid, email, workflowId, inputs: validation.cleaned });
    await dispatchWorkflow(workflowId, validation.cleaned);
    logEvent({ level: 'info', type: 'run_accepted', requestId, workflowId, uid });

    return res.json({
      accepted: true,
      message: 'Запрос на запуск принят сервером и передан в GitHub Actions.',
      runUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${ALLOWED_WORKFLOWS[workflowId].path}`,
      runId: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent({ level: 'error', type: 'run_error', requestId, error: message });

    // Безопасные коды причин вместо утечки внутреннего текста GitHub.
    // Статус — 5xx (проблема на стороне связи с GitHub), причина — в поле code.
    if (err instanceof Error && err.name === 'AbortError') {
      return res.status(504).json({ message: 'github_timeout', code: 'github_timeout' });
    }
    if (/GitHub dispatch failed: 401/.test(message)) {
      return res.status(502).json({ message: 'github_auth_failed', code: 'github_auth_failed' });
    }
    if (/GitHub dispatch failed: 403/.test(message)) {
      return res.status(502).json({ message: 'github_forbidden', code: 'github_forbidden' });
    }
    if (/GitHub dispatch failed: 404/.test(message)) {
      return res.status(502).json({ message: 'github_not_found', code: 'github_not_found' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
});

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  app.listen(PORT, () => logEvent({ level: 'info', type: 'server_start', port: Number(PORT) }));
}
