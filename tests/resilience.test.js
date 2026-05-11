import assert from 'node:assert/strict';
import test from 'node:test';
import { externalError, ResilientClient } from '../server/resilience.js';

test('opens after threshold and half-opens after cooldown', async () => {
  let now = 0;
  const client = new ResilientClient('test', {
    failureThreshold: 2,
    cooldownMs: 100,
    retries: 0,
    now: () => now,
    sleep: async () => {}
  });

  await assert.rejects(() => client.run(async () => { throw externalError('bad', 'http_5xx'); }), /bad/);
  assert.equal(client.snapshot().state, 'closed');
  await assert.rejects(() => client.run(async () => { throw externalError('bad', 'http_5xx'); }), /bad/);
  assert.equal(client.snapshot().state, 'open');
  await assert.rejects(() => client.run(async () => 'nope'), (error) => error.kind === 'breaker_open');
  assert.equal(client.snapshot().recent[0].errorKind, 'breaker_open');

  now += 101;
  const value = await client.run(async () => 'ok');
  assert.equal(value, 'ok');
  assert.equal(client.snapshot().state, 'closed');
});

test('returns to open when half-open probe fails', async () => {
  let now = 0;
  const client = new ResilientClient('test', {
    failureThreshold: 1,
    cooldownMs: 50,
    retries: 0,
    now: () => now,
    sleep: async () => {}
  });
  await assert.rejects(() => client.run(async () => { throw externalError('bad', 'http_5xx'); }));
  now += 51;
  await assert.rejects(() => client.run(async () => { throw externalError('still bad', 'http_5xx'); }));
  assert.equal(client.snapshot().state, 'open');
});

test('rejects concurrent half-open probes', async () => {
  let now = 0;
  let release;
  const client = new ResilientClient('test', {
    failureThreshold: 1,
    cooldownMs: 10,
    retries: 0,
    now: () => now,
    sleep: async () => {}
  });
  await assert.rejects(() => client.run(async () => { throw externalError('bad', 'http_5xx'); }));
  now += 11;
  const first = client.run(async () => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(() => client.run(async () => 'second'), (error) => error.kind === 'breaker_open');
  release('first');
  assert.equal(await first, 'first');
});

test('retries retryable failures and records recent attempts', async () => {
  let calls = 0;
  const client = new ResilientClient('test', {
    retries: 1,
    backoffMs: 1,
    sleep: async () => {}
  });
  const result = await client.run(async () => {
    calls += 1;
    if (calls === 1) throw externalError('temporary', 'http_5xx');
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.equal(client.snapshot().recent.length, 2);
});

test('classifies abort caused by timeout', async () => {
  const client = new ResilientClient('test', {
    retries: 0,
    timeoutMs: 1
  });
  await assert.rejects(
    () => client.run(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })),
    (error) => error.kind === 'timeout'
  );
});
