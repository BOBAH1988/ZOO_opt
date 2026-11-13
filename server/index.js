import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import admin from 'firebase-admin';

const PORT = process.env.PORT || 8787;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'BOBAH1988';
const GITHUB_REPO = process.env.GITHUB_REPO || 'mail-automation';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const ALLOWED_UIDS = (process.env.ALLOWED_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);

const ALLOWED_WORKFLOWS = {
  tests: { path: '.github/workflows/tests.yml', inputs: {} },
  kpi_sales: { path: '.github/workflows/kpi_sales.yml', inputs: {} },
  weekly_fri: { path: '.github/workflows/weekly_fri.yml', inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' }, realSendGuard: true },
  weekly_mon_tue: { path: '.github/workflows/weekly_mon_tue.yml', inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' }, realSendGuard: true },
  weekly_wed: { path: '.github/workflows/weekly_wed.yml', inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' }, realSendGuard: true },
  weekly_residues: { path: '.github/workflows/weekly_residues.yml', inputs: { test_mode: 'boolean' }, realSendGuard: true },
  weekly_sety_price: { path: '.github/workflows/weekly_sety_price.yml', inputs: { test_mode: 'boolean', skip_if_sent: 'boolean' }, realSendGuard: true },
};

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

function validateInputs(workflowId, inputs) {
  const spec = ALLOWED_WORKFLOWS[workflowId];
  if (!spec) return { ok: false, error: 'Workflow is not allowed' };
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return { ok: false, error: 'inputs must be an object' };
  const cleaned = {};
  for (const [key, value] of Object.entries(inputs)) {
    const expected = spec.inputs[key];
    if (!expected) return { ok: false, error: `Unknown input: ${key}` };
    if (expected === 'boolean' && typeof value !== 'boolean') return { ok: false, error: `${key} must be boolean` };
    if (expected === 'string' && typeof value !== 'string') return { ok: false, error: `${key} must be string` };
    if (expected === 'string' && value.length > 100) return { ok: false, error: `${key} is too long` };
    cleaned[key] = value;
  }
  if (spec.realSendGuard && cleaned.test_mode === false) {
    logEvent({ level: 'warn', type: 'real_send_requested', workflowId });
  }
  return { ok: true, cleaned };
}

async function dispatchWorkflow(workflowId, inputs) {
  const spec = ALLOWED_WORKFLOWS[workflowId];
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${encodeURIComponent(spec.path)}/dispatches`;
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
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub dispatch failed: ${res.status} ${text}`);
  }
  return { accepted: true };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/run', async (req, res) => {
  const requestId = crypto.randomUUID();
  try {
    initFirebaseAdmin();
    if (!GITHUB_TOKEN) return res.status(500).json({ message: 'Server is not configured (missing GITHUB_TOKEN)' });

    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ message: 'Missing bearer token' });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const uid = decoded.uid;
    const email = decoded.email || null;
    if (ALLOWED_UIDS.length > 0 && !ALLOWED_UIDS.includes(uid)) {
      logEvent({ level: 'warn', type: 'forbidden_uid', requestId, uid });
      return res.status(403).json({ message: 'User is not allowed to run workflows' });
    }

    const { workflowId, inputs } = req.body || {};
    if (typeof workflowId !== 'string' || !ALLOWED_WORKFLOWS[workflowId]) {
      return res.status(400).json({ message: 'Workflow is not allowed' });
    }

    const validation = validateInputs(workflowId, inputs || {});
    if (!validation.ok) return res.status(400).json({ message: validation.error });

    logEvent({ level: 'info', type: 'run_request', requestId, uid, email, workflowId, inputs: validation.cleaned });
    await dispatchWorkflow(workflowId, validation.cleaned);
    logEvent({ level: 'info', type: 'run_accepted', requestId, workflowId, uid });

    return res.json({
      accepted: true,
      message: 'Запрос на запуск принят сервером и передан в GitHub Actions.',
      runUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${encodeURIComponent(ALLOWED_WORKFLOWS[workflowId].path)}`,
      runId: null,
    });
  } catch (err) {
    logEvent({ level: 'error', type: 'run_error', requestId, error: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.listen(PORT, () => logEvent({ level: 'info', type: 'server_start', port: Number(PORT) }));
