/**
 * Общие правила запуска workflow — ОДИН источник для Express (server/index.js)
 * и Cloudflare Worker (server/cloudflare/src/index.js).
 *
 * ЗАЧЕМ
 * Раньше ALLOWED_WORKFLOWS и валидация входа жили двумя копиями. Правка
 * списка в одном месте оставляла вторую копию с дырой: Express разрешал
 * запуск, который Worker уже запрещал (или наоборот). Теперь список один.
 *
 * МОДУЛЬ БЕЗ ЗАВИСИМОСТЕЙ
 * Ничего не импортирует и не трогает сеть/файлы: работает и в Node, и в
 * Workers runtime.
 */

export const PROJECT_ALLOWLIST = new Set([
  'order', 'ukhta', 'veta', 'clients', 'payments', 'invoice', 'veles',
  'lemur', 'dz', 'sety', 'debt_ukhta', 'mamedov',
]);

/**
 * Разрешённые workflow и их входные параметры.
 *
 * path — имя файла в .github/workflows/. Одинаково для Express и Worker.
 * realSendGuard — запуск с test_mode=false шлёт реальные письма и требует
 *                 отдельного разрешения (REAL_SEND_UIDS) на сервере.
 */
export const ALLOWED_WORKFLOWS = {
  kpi_sales: { path: 'kpi_sales.yml', inputs: { owner_uid: 'string', test_mode: 'boolean' } },
  weekly_fri: { path: 'weekly_fri.yml', inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' }, realSendGuard: true },
  weekly_mon_tue: { path: 'weekly_mon_tue.yml', inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' }, realSendGuard: true },
  weekly_wed: { path: 'weekly_wed.yml', inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' }, realSendGuard: true },
  weekly_residues: { path: 'weekly_residues.yml', inputs: { test_mode: 'boolean' }, realSendGuard: true },
  weekly_sety_price: { path: 'weekly_sety_price.yml', inputs: { test_mode: 'boolean', skip_if_sent: 'boolean' }, realSendGuard: true },
  weekly_tue: { path: 'weekly_tue.yml', inputs: { test_mode: 'boolean', only: 'string', ignore_window: 'boolean' }, realSendGuard: true },
  git_check_invoices: { path: 'git_check_invoices.yml', inputs: { test_mode: 'boolean', project: 'string' } },
  update_sales_report: { path: 'update_sales_report.yml', inputs: {} },
};

/**
 * Проверяет входные параметры запуска.
 *
 * Принимает уже извлечённые workflowId и inputs. Возвращает
 * { ok: true, workflow, cleaned } либо { ok: false, error }.
 *
 * Поля нормализуются здесь, а не в вызывающем коде: 'only' приводится к
 * списку проектов через запятую без пробелов, пустой 'project' для
 * git_check_invoices означает оба проекта сразу.
 */
export function validateWorkflowInputs(workflowId, inputs) {
  if (typeof workflowId !== 'string' || !ALLOWED_WORKFLOWS[workflowId]) {
    return { ok: false, error: 'Workflow is not allowed' };
  }
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return { ok: false, error: 'inputs must be an object' };
  }

  const spec = ALLOWED_WORKFLOWS[workflowId];
  const cleaned = {};

  for (const [key, value] of Object.entries(inputs)) {
    const expected = spec.inputs[key];
    if (!expected) return { ok: false, error: `Unknown input: ${key}` };
    if (typeof value !== expected) return { ok: false, error: `${key} must be ${expected}` };
    if (typeof value === 'string' && value.length > 100) {
      return { ok: false, error: `${key} is too long` };
    }

    if (key === 'only') {
      const projects = value.split(',').map((p) => p.trim()).filter(Boolean);
      for (const p of projects) {
        if (!PROJECT_ALLOWLIST.has(p)) {
          return { ok: false, error: `Unknown project in only: ${p}` };
        }
      }
      cleaned[key] = projects.join(',');
    } else if (key === 'project' && workflowId === 'git_check_invoices') {
      if (value === '') {
        cleaned[key] = 'clients,payments';
      } else if (!['clients', 'payments'].includes(value)) {
        return { ok: false, error: `Unknown project: ${value}` };
      } else {
        cleaned[key] = value;
      }
    } else {
      cleaned[key] = value;
    }
  }

  if (spec.realSendGuard && typeof cleaned.test_mode !== 'boolean') {
    return { ok: false, error: 'test_mode must be boolean' };
  }

  return { ok: true, workflow: spec, cleaned };
}
