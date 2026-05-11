import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger, formatTextRecord, redact } from '../server/logger.js';

function memoryStream(lines) {
  return { write: (line) => lines.push(line.trimEnd()) };
}

test('filters by level and routes warn/error to stderr', () => {
  const out = [];
  const err = [];
  const logger = createLogger({
    tag: 'test',
    level: 'warn',
    stdout: memoryStream(out),
    stderr: memoryStream(err)
  });
  logger.info('hidden');
  logger.warn('visible');
  assert.deepEqual(out, []);
  assert.equal(err.length, 1);
  assert.match(err[0], /visible/);
});

test('binds tag and child fields without mutating parent', () => {
  const out = [];
  const root = createLogger({ tag: 'root', format: 'text', stdout: memoryStream(out), stderr: memoryStream(out) });
  const child = root.withTag('route').child({ reqId: 'abc' });
  root.info('parent');
  child.info('child');
  assert.match(out[0], /\[root\]/);
  assert.doesNotMatch(out[0], /reqId=abc/);
  assert.match(out[1], /\[route\]/);
  assert.match(out[1], /reqId=abc/);
});

test('redacts secret fields at any depth', () => {
  assert.deepEqual(redact({
    authorization: 'Bearer x',
    nested: { NETEASE_COOKIE: 'secret', safe: 'ok' }
  }), {
    authorization: '[REDACTED]',
    nested: { NETEASE_COOKIE: '[REDACTED]', safe: 'ok' }
  });
});

test('emits round-trippable json records', () => {
  const out = [];
  const logger = createLogger({
    tag: 'json',
    format: 'json',
    stdout: memoryStream(out),
    stderr: memoryStream(out)
  });
  logger.info('hello', { token: 'secret', value: 42 });
  const parsed = JSON.parse(out[0]);
  assert.equal(parsed.tag, 'json');
  assert.equal(parsed.msg, 'hello');
  assert.equal(parsed.token, '[REDACTED]');
  assert.equal(parsed.value, 42);
});

test('formats text records with key value pairs', () => {
  const line = formatTextRecord({ ts: 'now', level: 'info', tag: 'app', msg: 'ok', value: 3 });
  assert.equal(line, 'now info [app] ok value=3');
});
