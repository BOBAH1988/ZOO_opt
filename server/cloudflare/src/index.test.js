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
  const result = validateWorkflowRequest({ workflowId: 'tests' });

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
