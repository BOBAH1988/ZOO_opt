import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInputs, PROJECT_ALLOWLIST } from './index.js';

test('accepts a known workflow and valid inputs', () => {
  const result = validateInputs('weekly_wed', {
    test_mode: true,
    only: 'invoice',
    ignore_window: false,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.cleaned, { test_mode: true, only: 'invoice', ignore_window: false });
});

test('accepts workflows that have no inputs', () => {
  const result = validateInputs('kpi_sales', {});

  assert.equal(result.ok, true);
  assert.deepEqual(result.cleaned, {});
});

test('rejects unknown workflows', () => {
  assert.equal(validateInputs('arbitrary', {}).ok, false);
  assert.equal(validateInputs('weekly_wed', { arbitrary: 'value' }).ok, false);
});

test('rejects inputs with wrong type or excessive length', () => {
  assert.equal(validateInputs('weekly_wed', { test_mode: 'true' }).ok, false);

  assert.equal(validateInputs('weekly_wed', { only: 'a'.repeat(101) }).ok, false);
});

test('requires an explicit test_mode for workflows that can send real emails', () => {
  const result = validateInputs('weekly_wed', {});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'test_mode must be boolean');
});

test('PROJECT_ALLOWLIST contains all real project keys from run_all.py', () => {
  const expected = new Set([
    'order', 'ukhta', 'veta', 'clients', 'payments', 'invoice', 'veles',
    'lemur', 'dz', 'sety', 'debt_ukhta', 'mamedov',
  ]);
  assert.deepEqual([...PROJECT_ALLOWLIST].sort(), [...expected].sort());
});

test('PROJECT_ALLOWLIST does not contain the removed alias prusakova', () => {
  assert.equal(PROJECT_ALLOWLIST.has('prusakova'), false);
});

test('PROJECT_ALLOWLIST contains invoice (not prusakova)', () => {
  assert.equal(PROJECT_ALLOWLIST.has('invoice'), true);
  assert.equal(PROJECT_ALLOWLIST.has('debt_ukhta'), true);
  assert.equal(PROJECT_ALLOWLIST.has('mamedov'), true);
});

test('git_check_invoices accepts valid inputs', () => {
  const result = validateInputs('git_check_invoices', { test_mode: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cleaned, { test_mode: true });
});

test('git_check_invoices accepts no inputs', () => {
  const result = validateInputs('git_check_invoices', {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.cleaned, {});
});

test('git_check_invoices accepts project input', () => {
  const result = validateInputs('git_check_invoices', { project: 'payments' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cleaned, { project: 'payments' });
});

test('git_check_invoices accepts project with test_mode', () => {
  const result = validateInputs('git_check_invoices', { test_mode: true, project: 'clients' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cleaned, { test_mode: true, project: 'clients' });
});

test('git_check_invoices rejects test_mode with wrong type', () => {
  const result = validateInputs('git_check_invoices', { test_mode: 'true' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'test_mode must be boolean');
});

test('git_check_invoices rejects unknown input', () => {
  const result = validateInputs('git_check_invoices', { arbitrary: 'value' });
  assert.equal(result.ok, false);
});

test('git_check_invoices rejects project with wrong type', () => {
  const result = validateInputs('git_check_invoices', { project: 123 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'project must be string');
});

test('other workflows reject unknown project input', () => {
  const result = validateInputs('weekly_fri', { test_mode: true, project: 'clients' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Unknown input: project');
});

test('git_check_invoices rejects project not in clients/payments', () => {
  const result = validateInputs('git_check_invoices', { project: 'residues' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Unknown project: residues');
});

test('git_check_invoices empty project runs both clients and payments', () => {
  const result = validateInputs('git_check_invoices', { project: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cleaned, { project: 'clients,payments' });
});
