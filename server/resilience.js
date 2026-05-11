const retryableKinds = new Set(['timeout', 'network', 'http_5xx']);

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function classifyError(error) {
  if (error?.kind) return error.kind;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'timeout';
  if (error instanceof SyntaxError) return 'parse';
  if (error?.cause?.code || ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) return 'network';
  return 'other';
}

export function externalError(message, kind = 'other', cause = null) {
  const error = new Error(message);
  error.kind = kind;
  if (cause) error.cause = cause;
  return error;
}

export function classifyHttpStatus(status, label = 'request') {
  if (status >= 500) return externalError(`${label} failed with ${status}`, 'http_5xx');
  if (status >= 400) return externalError(`${label} failed with ${status}`, 'http_4xx');
  return null;
}

export class ResilientClient {
  constructor(name, {
    failureThreshold = 5,
    cooldownMs = 30_000,
    timeoutMs = 10_000,
    retries = 2,
    backoffMs = 200,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.backoffMs = backoffMs;
    this.now = now;
    this.sleep = sleep;
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.probeInFlight = false;
    this.recent = [];
    this.lastCallAt = null;
    this.lastErrorAt = null;
    this.lastErrorKind = null;
  }

  snapshot() {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      lastCallAt: this.lastCallAt ? new Date(this.lastCallAt).toISOString() : null,
      lastErrorAt: this.lastErrorAt ? new Date(this.lastErrorAt).toISOString() : null,
      lastErrorKind: this.lastErrorKind,
      recent: [...this.recent].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    };
  }

  beforeRun() {
    if (this.state === 'open') {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half-open';
      } else {
        throw externalError('Circuit breaker is open', 'breaker_open');
      }
    }
    if (this.state === 'half-open') {
      if (this.probeInFlight) throw externalError('Circuit breaker probe already in flight', 'breaker_open');
      this.probeInFlight = true;
    }
  }

  recordAttempt(start, ok, kind = null) {
    const end = this.now();
    this.lastCallAt = end;
    if (!ok) {
      this.lastErrorAt = end;
      this.lastErrorKind = kind;
    }
    this.recent.unshift({
      timestamp: new Date(end).toISOString(),
      durMs: Math.max(0, end - start),
      ok,
      errorKind: kind
    });
    this.recent = this.recent.slice(0, 20);
  }

  afterSuccess() {
    this.consecutiveFailures = 0;
    this.state = 'closed';
    this.openedAt = null;
    this.probeInFlight = false;
  }

  afterFailure() {
    if (this.state === 'half-open') {
      this.state = 'open';
      this.openedAt = this.now();
      this.probeInFlight = false;
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  async run(fn, overrides = {}) {
    const guardStart = this.now();
    try {
      this.beforeRun();
    } catch (error) {
      const kind = classifyError(error);
      this.recordAttempt(guardStart, false, kind);
      throw error;
    }
    let lastError = null;
    const maxRetries = overrides.retries ?? this.retries;
    const timeoutMs = overrides.timeoutMs ?? this.timeoutMs;
    const attempts = maxRetries + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const start = this.now();
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const result = await fn({ signal: controller.signal, attempt });
        clearTimeout(timeout);
        this.recordAttempt(start, true, null);
        this.afterSuccess();
        return result;
      } catch (error) {
        clearTimeout(timeout);
        const kind = timedOut ? 'timeout' : classifyError(error);
        this.recordAttempt(start, false, kind);
        lastError = error?.kind === kind ? error : externalError(error?.message ?? kind, kind, error);
        if (attempt >= maxRetries || !retryableKinds.has(kind)) break;
        await this.sleep(this.backoffMs * (2 ** attempt));
      }
    }

    this.afterFailure();
    throw lastError;
  }
}

function clientPolicy(name) {
  const upper = name.toUpperCase();
  const defaultTimeout = name === 'tts' ? 15_000 : name === 'netease' ? 8_000 : 10_000;
  return {
    failureThreshold: numberEnv(`${upper}_BREAKER_THRESHOLD`, 5),
    cooldownMs: numberEnv(`${upper}_BREAKER_COOLDOWN_MS`, 30_000),
    timeoutMs: numberEnv(`${upper}_TIMEOUT_MS`, defaultTimeout),
    retries: numberEnv(`${upper}_RETRIES`, 2)
  };
}

const clients = new Map([
  ['llm', new ResilientClient('llm', clientPolicy('llm'))],
  ['tts', new ResilientClient('tts', clientPolicy('tts'))],
  ['netease', new ResilientClient('netease', clientPolicy('netease'))]
]);

export function getExternalClient(name) {
  if (!clients.has(name)) clients.set(name, new ResilientClient(name, clientPolicy(name)));
  return clients.get(name);
}

export function runExternal(name, fn, overrides = {}) {
  return getExternalClient(name).run(fn, overrides);
}

export function externalSnapshots() {
  return Object.fromEntries([...clients.entries()].map(([name, client]) => [name, client.snapshot()]));
}
