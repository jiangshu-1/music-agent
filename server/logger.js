const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const secretExact = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apiKey',
  'token',
  'password',
  'FISH_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'NINEROUTER_API_KEY',
  'NETEASE_COOKIE'
]);

function normalizeLevel(level) {
  return Object.hasOwn(levels, level) ? level : 'info';
}

function shouldRedactKey(key) {
  const upper = String(key).toUpperCase();
  return secretExact.has(key) || upper.includes('KEY') || upper.includes('TOKEN') || upper.includes('SECRET') || upper.includes('COOKIE');
}

export function redact(value, key = '') {
  if (key && shouldRedactKey(key)) return '[REDACTED]';
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item));
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
}

function formatValue(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value.includes(' ') ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

export function formatTextRecord(record) {
  const { ts, level, tag, msg, ...fields } = record;
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  return [`${ts}`, level, `[${tag}]`, msg, ...pairs].join(' ');
}

export function createLogger({
  tag = 'app',
  fields = {},
  level = process.env.LOG_LEVEL,
  format = process.env.LOG_FORMAT,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  const threshold = levels[normalizeLevel(level)];
  const activeFormat = format === 'json' ? 'json' : 'text';

  function emit(method, msg, callFields = {}) {
    if (levels[method] < threshold) return;
    const record = redact({
      ts: new Date().toISOString(),
      level: method,
      tag,
      msg,
      ...fields,
      ...callFields
    });
    const line = activeFormat === 'json' ? JSON.stringify(record) : formatTextRecord(record);
    const stream = method === 'warn' || method === 'error' ? stderr : stdout;
    stream.write(`${line}\n`);
  }

  return {
    debug: (msg, callFields) => emit('debug', msg, callFields),
    info: (msg, callFields) => emit('info', msg, callFields),
    warn: (msg, callFields) => emit('warn', msg, callFields),
    error: (msg, callFields) => emit('error', msg, callFields),
    child: (childFields = {}) => createLogger({ tag, fields: { ...fields, ...childFields }, level, format, stdout, stderr }),
    withTag: (childTag) => createLogger({ tag: childTag, fields, level, format, stdout, stderr })
  };
}

export const logger = createLogger();
