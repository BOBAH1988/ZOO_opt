import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflowRequest } from './index.js';

test('accepts a known workflow and valid inputs', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_fri',
    inputs: { test_mode: true, only: 'lemur', ignore_window: false },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { test_mode: true, only: 'lemur', ignore_window: false });
});

test('accepts workflows that have no inputs', () => {
  const result = validateWorkflowRequest({ workflowId: 'kpi_sales' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, {});
});

test('rejects unknown workflows and input names', () => {
  assert.equal(validateWorkflowRequest({ workflowId: 'arbitrary', inputs: {} }).ok, false);
  assert.equal(validateWorkflowRequest({
    workflowId: 'weekly_fri',
    inputs: { arbitrary: 'value' },
  }).ok, false);
});

test('rejects inputs with the wrong type or excessive length', () => {
  assert.equal(validateWorkflowRequest({
    workflowId: 'weekly_fri',
    inputs: { test_mode: 'true' },
  }).ok, false);

  assert.equal(validateWorkflowRequest({
    workflowId: 'weekly_fri',
    inputs: { only: 'a'.repeat(101) },
  }).ok, false);
});

test('requires an explicit test_mode for workflows that can send real emails', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_fri',
    inputs: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'test_mode must be boolean');
});

test('git_check_invoices accepts project input', () => {
  const result = validateWorkflowRequest({
    workflowId: 'git_check_invoices',
    inputs: { project: 'payments' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { project: 'payments' });
});

test('git_check_invoices accepts project with test_mode', () => {
  const result = validateWorkflowRequest({
    workflowId: 'git_check_invoices',
    inputs: { test_mode: true, project: 'clients' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { test_mode: true, project: 'clients' });
});

test('git_check_invoices rejects project with wrong type', () => {
  const result = validateWorkflowRequest({
    workflowId: 'git_check_invoices',
    inputs: { project: 123 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'project must be string');
});

test('other workflows reject unknown project input', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_fri',
    inputs: { test_mode: true, project: 'clients' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Unknown input: project');
});

test('git_check_invoices rejects project not in clients/payments', () => {
  const result = validateWorkflowRequest({
    workflowId: 'git_check_invoices',
    inputs: { project: 'residues' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Unknown project: residues');
});

test('git_check_invoices empty project runs both clients and payments', () => {
  const result = validateWorkflowRequest({
    workflowId: 'git_check_invoices',
    inputs: { project: '' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { project: 'clients,payments' });
});

test('weekly_mon_tue accepts test_mode, only, ignore_window', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_mon_tue',
    inputs: { test_mode: true, only: 'clients,payments', ignore_window: true },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { test_mode: true, only: 'clients,payments', ignore_window: true });
});

test('weekly_tue accepts test_mode, only, ignore_window', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_tue',
    inputs: { test_mode: false, only: 'ukhta', ignore_window: false },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { test_mode: false, only: 'ukhta', ignore_window: false });
});

test('weekly_wed accepts test_mode, only, ignore_window', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_wed',
    inputs: { test_mode: true, only: 'invoice', ignore_window: true },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { test_mode: true, only: 'invoice', ignore_window: true });
});

test('weekly_fri accepts test_mode, only, ignore_window', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_fri',
    inputs: { test_mode: false, only: 'lemur', ignore_window: false },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { test_mode: false, only: 'lemur', ignore_window: false });
});

test('weekly_sety_price accepts test_mode and skip_if_sent', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_sety_price',
    inputs: { test_mode: true, skip_if_sent: false },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { test_mode: true, skip_if_sent: false });
});

test('weekly_residues accepts test_mode', () => {
  const result = validateWorkflowRequest({
    workflowId: 'weekly_residues',
    inputs: { test_mode: true },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { test_mode: true });
});

test('kpi_sales accepts owner_uid', () => {
  const result = validateWorkflowRequest({
    workflowId: 'kpi_sales',
    inputs: { owner_uid: 'user@example.com' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, { owner_uid: 'user@example.com' });
});

test('kpi_sales accepts empty owner_uid', () => {
  const result = validateWorkflowRequest({
    workflowId: 'kpi_sales',
    inputs: {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, {});
});

test('update_sales_report accepts no inputs', () => {
  const result = validateWorkflowRequest({
    workflowId: 'update_sales_report',
    inputs: {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.inputs, {});
});
