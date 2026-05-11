# Requirements Document

## Introduction

Claudio's Node.js server has grown organically: `server/router.js` is now 895 lines of sequential `if/else` URL matching, `server/db.js` mixes many concerns in 685 lines, external calls to the LLM, Fish TTS, and the NetEase-compatible API only have `try/catch` fallbacks with no retry or breaker, logging is bare `console.*` with no levels or request correlation, and there are no unit or integration tests.

The **Server Refactor Foundation** feature prepares the server for future work by doing four things in parallel without changing any user-visible behavior or public HTTP response shapes:

1. A modular route-table replacement for the `if/else` chain in `server/router.js`, with domain-split files under `server/routes/`, uniform body parsing, JSON helpers, 404/405, and error handling.
2. A structured logger (`server/logger.js`) with levels, tags, request-scoped child loggers, env-driven level and format, and secret redaction.
3. A resilience helper wrapping LLM, Fish TTS, and NetEase clients with timeout, bounded retry, a circuit breaker, and a recent-call ring buffer exposed on `/api/health`.
4. A `node:test`-based testing foundation covering the new router core, circuit breaker state machine, logger behavior, and a thin integration boot test, wired into `npm test` and `npm run check`.

The feature is an internal refactor: no new endpoints, no new dependencies (unless unavoidable), and every existing `(method, path)` pair must continue to return the same response shape for the same input.

## Glossary

- **Server**: The Node.js HTTP server started by `server/index.js`, bound to `HOST:PORT` (default `0.0.0.0:8080`).
- **Router_Core**: The new module that registers and dispatches route handlers by exact `(method, path)` match and owns body parsing, JSON response, 404, 405, and error handling.
- **Route_Module**: A file under `server/routes/` that exports one or more route definitions for a single domain (e.g. `now`, `queue`, `stations`, `feedback`, `library`, `netease`, `tts`, `sleep-timer`, `insights`, `cast`, `ambience`, `dj`, `health`, `backup`, `network`, `chat`, `audio`, `lyric`, `taste`, `plan`, `transport`, `song`).
- **Route_Definition**: An object of the form `{ method, path, handler }` where `method` is an uppercase HTTP verb, `path` is an exact pathname string (query strings are not part of the match), and `handler` is an async function `(req, res) => void`.
- **Request_Id**: A string attached to every incoming request as `req.reqId`, unique per request, used for log correlation.
- **Request_Logger**: A child logger returned by the Logger with bound fields `reqId`, `method`, `path`, and at request end also `status` and `durMs`.
- **Static_Server**: The existing static file handler that serves `/`, `/mini`, `/mini/`, and any path resolving under `web/`. Its behavior is preserved exactly.
- **Logger**: The module at `server/logger.js` that exposes level-aware log methods (`debug`, `info`, `warn`, `error`), a `child(fields)` method that returns a new logger with merged bound fields, and a `withTag(tag)` factory for module-level loggers.
- **Log_Level**: One of `debug`, `info`, `warn`, `error`, in that order of increasing severity. The active threshold is read from `process.env.LOG_LEVEL`, defaulting to `info`.
- **Log_Format**: Either `text` (human-readable, default) or `json` (one JSON object per line), selected by `process.env.LOG_FORMAT`.
- **Secret_Field**: Any field whose key matches a documented redaction list (`authorization`, `cookie`, `set-cookie`, `api_key`, `apiKey`, `token`, `password`, `FISH_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `NETEASE_COOKIE`, and any env var name containing `KEY`, `TOKEN`, `SECRET`, or `COOKIE`).
- **External_Client**: One of the three wrapped outbound clients: the LLM client (`server/llm.js`), the Fish TTS client (`server/tts.js`), or the NetEase client (`server/netease.js`).
- **Resilience_Wrapper**: A helper (e.g. `server/resilience.js`) that wraps an async function with a named policy providing timeout, bounded retry, circuit breaker, and call-history recording.
- **Circuit_Breaker**: A per-`External_Client` state machine with states `closed`, `open`, `half-open` and the transitions defined in Requirement 3.
- **Call_History**: A bounded ring buffer of the most recent 20 calls per `External_Client`, each entry containing `{ timestamp, durMs, ok, errorKind | null }`.
- **Error_Kind**: A short string classifying a failure, one of `timeout`, `network`, `http_5xx`, `http_4xx`, `parse`, `breaker_open`, `other`.
- **Health_Endpoint**: The existing `GET /api/health` endpoint, extended (additively, no field removals or renames) to include per-`External_Client` breaker state and `Call_History` summary.
- **Smoke_Script**: `scripts/smoke.js`, the existing read-only HTTP check script. Its contents and pass criteria remain unchanged.
- **Check_Script**: `scripts/check.js`, the existing syntax-and-smoke driver.
- **Test_Suite**: All files under `tests/` runnable via `node --test` using the built-in `node:test` runner.
- **Integration_Boot_Test**: A test that boots the `Server` on an ephemeral port with a temporary `data/` directory and issues HTTP requests to representative endpoints.
- **Response_Shape**: The JSON structure of a successful response for a given `(method, path, input)` tuple, including field names, types, and whether fields are present. Unordered array elements are considered equivalent if they contain the same set of items.
- **Public_Endpoint**: Any `(method, path)` pair currently handled by `server/router.js` at the start of this feature.

## Requirements

### Requirement 1: Modular Route Registration

**User Story:** As a maintainer, I want routes registered in a route table split by domain, so that I can find and change a handler without scrolling through a 900-line `if/else` chain.

#### Acceptance Criteria

1. THE Router_Core SHALL expose a function to register a Route_Definition with fields `method`, `path`, and `handler`.
2. WHEN the Router_Core receives a request, THE Router_Core SHALL dispatch to the first Route_Definition whose `method` equals the request method (case-insensitive) and whose `path` equals the request URL pathname exactly (query string excluded).
3. IF no Route_Definition matches the pathname, THEN THE Router_Core SHALL delegate the request to the Static_Server.
4. IF the Static_Server cannot resolve the pathname to a file under `web/`, THEN THE Router_Core SHALL respond with HTTP 404 and body `Not found` with content type `text/plain; charset=utf-8`.
5. IF at least one Route_Definition matches the pathname but none matches the method, THEN THE Router_Core SHALL respond with HTTP 405, an `Allow` header listing the allowed methods in uppercase alphabetical order separated by `, `, and a JSON body `{ "error": "Method not allowed" }`.
6. THE Router_Core SHALL preserve the existing Static_Server behavior for `/`, `/mini`, `/mini/`, and every path currently resolvable under `web/`, including the existing MIME type mapping and `cache-control: no-store` for `.html`, `.css`, and `.js`.
7. THE `server/routes/` directory SHALL contain one Route_Module per domain covering at least: `now`, `queue`, `stations`, `feedback`, `library`, `netease`, `tts`, `sleep-timer`, `insights`, `cast`, `ambience`, `dj`, `health`, `backup`, `network`, `chat`, `audio`, `lyric`, `taste`, `plan`, `transport`, `song`.
8. THE Router_Core SHALL register every Public_Endpoint via a Route_Module so that no HTTP handling logic beyond dispatch and Static_Server fallback remains in `server/router.js`.
9. FOR ALL Public_Endpoints, given identical request method, pathname, query string, headers, and body, the response status code, response headers (excluding `x-request-id` and `date`), and Response_Shape SHALL be equivalent to the pre-refactor response (route parity property).

### Requirement 2: Uniform Request Handling Primitives

**User Story:** As a maintainer, I want body parsing, JSON responses, and error handling to be uniform, so that every handler does not re-implement `readBody`, `json`, and try/catch.

#### Acceptance Criteria

1. THE Router_Core SHALL provide a JSON response helper that writes status code, `content-type: application/json; charset=utf-8`, and a JSON-serialized body.
2. THE Router_Core SHALL provide a JSON body parser that resolves to a parsed object for valid JSON bodies up to 1,000,000 bytes.
3. IF a request body exceeds 1,000,000 bytes, THEN THE JSON body parser SHALL reject the request and THE Router_Core SHALL respond with HTTP 413 and JSON body `{ "error": "Payload too large" }`.
4. IF a request body is not valid JSON, THEN THE JSON body parser SHALL resolve to an empty object `{}` so that handlers observe the same pre-refactor behavior.
5. WHEN a handler throws or returns a rejected promise, THE Router_Core SHALL respond with HTTP 500, `content-type: application/json; charset=utf-8`, and JSON body `{ "error": <error.message> }` if no response has been sent.
6. IF a handler has already written response headers before throwing, THEN THE Router_Core SHALL log the error via the Request_Logger at level `error` and SHALL NOT attempt to modify the response.
7. WHEN a request arrives, THE Router_Core SHALL attach a Request_Id to `req.reqId` before invoking any handler.
8. WHEN a request arrives, THE Router_Core SHALL attach a Request_Logger to `req.log` with bound fields `reqId`, `method`, and `path`.
9. THE Router_Core SHALL set a response header `x-request-id` equal to `req.reqId` before any handler-written body is sent.
10. WHEN a request completes (response finished or connection closed), THE Router_Core SHALL emit one `info`-level log entry from the Request_Logger with fields `status` and `durMs` where `durMs` is the elapsed milliseconds since request start.

### Requirement 3: Circuit Breaker State Machine

**User Story:** As a maintainer, I want a documented circuit breaker per External_Client, so that a failing upstream cannot hold every request for the full timeout and so failures are observable.

#### Acceptance Criteria

1. THE Circuit_Breaker SHALL start in the `closed` state on server startup.
2. WHILE in the `closed` state, THE Resilience_Wrapper SHALL invoke the wrapped function on every call.
3. WHEN a call succeeds in the `closed` state, THE Circuit_Breaker SHALL reset its consecutive failure count to zero and remain in the `closed` state.
4. WHEN a call fails in the `closed` state, THE Circuit_Breaker SHALL increment its consecutive failure count.
5. WHEN the consecutive failure count reaches the configured threshold (default 5) in the `closed` state, THE Circuit_Breaker SHALL transition to the `open` state and record the transition time.
6. WHILE in the `open` state and the time since the transition is less than the configured cool-down window (default 30,000 ms), THE Resilience_Wrapper SHALL fail immediately with Error_Kind `breaker_open` without invoking the wrapped function.
7. WHEN the cool-down window elapses in the `open` state, THE Circuit_Breaker SHALL transition to the `half-open` state on the next call attempt.
8. WHILE in the `half-open` state, THE Resilience_Wrapper SHALL allow at most one concurrent probe call; additional concurrent calls SHALL fail immediately with Error_Kind `breaker_open`.
9. WHEN the probe call succeeds in the `half-open` state, THE Circuit_Breaker SHALL transition to the `closed` state and reset the consecutive failure count to zero.
10. WHEN the probe call fails in the `half-open` state, THE Circuit_Breaker SHALL transition back to the `open` state and reset the cool-down timer.
11. THE Circuit_Breaker configuration (failure threshold, cool-down window, per-call timeout, retry count) SHALL be per-External_Client and overridable via environment variables documented in the design.

### Requirement 4: Resilience for External Clients

**User Story:** As a maintainer, I want every outbound LLM, TTS, and NetEase call wrapped with timeout, bounded retry, and circuit breaking, so that a slow or dead upstream degrades gracefully and predictably.

#### Acceptance Criteria

1. THE Resilience_Wrapper SHALL enforce a configurable per-call timeout (default 10,000 ms for LLM, 15,000 ms for TTS, 8,000 ms for NetEase); when the timeout elapses the wrapped call SHALL be aborted and rejected with Error_Kind `timeout`.
2. WHEN a wrapped call fails with Error_Kind `timeout`, `network`, or `http_5xx`, THE Resilience_Wrapper SHALL retry the call up to the configured maximum (default 2 retries) with exponential backoff starting at 200 ms and doubling per attempt.
3. WHEN a wrapped call fails with Error_Kind `http_4xx` or `parse`, THE Resilience_Wrapper SHALL NOT retry and SHALL propagate the failure immediately.
4. THE Resilience_Wrapper SHALL apply the Circuit_Breaker from Requirement 3 around the retry loop so that the full retry sequence counts as a single success or failure for breaker accounting.
5. THE Resilience_Wrapper SHALL record every call attempt into the owning External_Client's Call_History with `timestamp`, `durMs`, `ok`, and `errorKind` (or `null` on success), keeping at most 20 entries by dropping the oldest.
6. THE LLM, Fish TTS, and NetEase modules SHALL route every outbound request through the Resilience_Wrapper.
7. FOR ALL Public_Endpoints that call an External_Client, WHEN the External_Client call fails for any reason including `breaker_open`, `timeout`, `http_5xx`, or `network`, the endpoint Response_Shape SHALL be equivalent to the pre-refactor fallback response for the same failure (no-regression-under-failure property).
8. THE Resilience_Wrapper SHALL NOT change the request payload, headers, URL, or response parsing of any External_Client.

### Requirement 5: Health Endpoint Observability

**User Story:** As an operator, I want `/api/health` to show the recent state of each External_Client, so that I can see at a glance when NetEase or the LLM last failed.

#### Acceptance Criteria

1. THE Health_Endpoint SHALL continue to return every field present in the pre-refactor response (additive change only).
2. THE Health_Endpoint SHALL include a new field `externals` whose value is an object keyed by External_Client name (`llm`, `tts`, `netease`) with per-client fields `state`, `consecutiveFailures`, `openedAt`, `lastCallAt`, `lastErrorAt`, `lastErrorKind`, and `recent`.
3. THE `state` field SHALL be one of `closed`, `open`, `half-open`.
4. THE `recent` field SHALL be an array of up to 20 Call_History entries ordered newest-first, each with `timestamp`, `durMs`, `ok`, and `errorKind`.
5. WHEN an External_Client has never been called since process start, THE Health_Endpoint SHALL report `state: "closed"`, `consecutiveFailures: 0`, and `recent: []`, with `lastCallAt`, `lastErrorAt`, `lastErrorKind`, and `openedAt` set to `null`.
6. THE Health_Endpoint response for a Call_History entry SHALL NOT include raw request bodies, response bodies, URLs with query strings, or headers.

### Requirement 6: Structured Logger

**User Story:** As a maintainer, I want a single logger with levels and tags, so that I can grep by module, correlate a request across modules, and silence debug noise in production.

#### Acceptance Criteria

1. THE Logger SHALL expose methods `debug`, `info`, `warn`, and `error` each accepting a message string and an optional fields object.
2. WHEN a log method is called, THE Logger SHALL emit the entry only if the method's Log_Level is greater than or equal to the active threshold from `process.env.LOG_LEVEL`.
3. IF `process.env.LOG_LEVEL` is unset or not one of `debug`, `info`, `warn`, `error`, THEN THE Logger SHALL use `info` as the active threshold.
4. WHERE `process.env.LOG_FORMAT` equals `json`, THE Logger SHALL emit each entry as a single line containing a JSON object with fields `ts`, `level`, `tag`, `msg`, and any bound or per-call fields merged in.
5. WHERE `process.env.LOG_FORMAT` is unset or any value other than `json`, THE Logger SHALL emit each entry as a human-readable line beginning with ISO-8601 timestamp, level, tag, message, and space-separated `key=value` pairs for fields.
6. THE Logger SHALL expose `withTag(tag)` returning a new logger whose entries carry the bound `tag`.
7. THE Logger SHALL expose `child(fields)` returning a new logger that merges `fields` into every entry; `child` SHALL be chainable and SHALL NOT mutate the parent logger.
8. WHEN a log entry's fields contain a Secret_Field key at any nesting depth, THE Logger SHALL replace the value with the literal string `[REDACTED]` before emitting (log redaction property).
9. THE Logger SHALL write `debug` and `info` entries to `stdout` and `warn` and `error` entries to `stderr`.
10. THE Server SHALL replace every `console.log`, `console.warn`, and `console.error` call in `server/*.js` with a Logger call, except for startup banner lines in `server/index.js` which MAY keep `console.log` if they are documented as pre-logger.

### Requirement 7: Request-Scoped Log Correlation

**User Story:** As a maintainer, I want every log line emitted during a request to include the request id, method, and path, so that I can reconstruct what happened for one request.

#### Acceptance Criteria

1. WHEN the Router_Core generates a Request_Id, THE Router_Core SHALL construct it so that Request_Ids are unique within a single process lifetime with probability greater than 1 − 10⁻⁹ for up to 10⁶ requests.
2. WHEN the Router_Core creates the Request_Logger, THE Router_Core SHALL derive it from the module-level Logger via `child({ reqId, method, path })`.
3. FOR ALL log entries emitted via `req.log` during a request, the entry SHALL include the request's `reqId`, `method`, and `path` fields (reqId propagation property).
4. WHEN a handler invokes a module that accepts an optional logger, THE handler SHALL pass `req.log` so that downstream entries inherit the same `reqId`.
5. THE Router_Core SHALL emit a single request-completion log entry per request at level `info` with `status` and `durMs`, regardless of whether the handler succeeded or threw.

### Requirement 8: JSON Parser and Pretty Printer for Log Records

**User Story:** As a maintainer, I want log records written in JSON mode to be round-trippable, so that I can pipe them to tools that parse and re-emit them without loss.

#### Acceptance Criteria

1. WHERE Log_Format is `json`, THE Logger SHALL emit each record as a single line of valid JSON parseable by `JSON.parse`.
2. THE Logger SHALL provide an internal pretty printer that formats a log record object into the human-readable text form.
3. FOR ALL log record objects produced by the Logger in `json` mode, parsing the emitted line with `JSON.parse` SHALL yield an object whose enumerable own properties equal the original record's enumerable own properties (round-trip property for JSON log records).
4. THE Logger SHALL never emit characters that require JSON string escaping (control characters, unescaped quotes, backslashes) outside of properly escaped JSON strings.

### Requirement 9: Testing Foundation

**User Story:** As a maintainer, I want a `node:test` based test suite wired into `npm test` and `npm run check`, so that regressions in the router, logger, and breaker are caught before they ship.

#### Acceptance Criteria

1. THE Test_Suite SHALL use only the built-in `node:test` runner and `node:assert` module; no new runtime or dev dependencies SHALL be added unless justified in the design.
2. THE Test_Suite SHALL include unit tests for the Router_Core covering route registration, exact method and path matching, 404 on unmatched pathnames that are not static files, 405 on method mismatch with correct `Allow` header, body parsing including the oversize-payload path, error handler behavior for thrown and rejected-promise handlers, and Request_Id attachment.
3. THE Test_Suite SHALL include unit tests for the Circuit_Breaker covering every transition in Requirement 3: `closed → open` at threshold, `open → half-open` after cool-down, `half-open → closed` on probe success, `half-open → open` on probe failure, and rejection of concurrent probes.
4. THE Test_Suite SHALL include unit tests for the Logger covering level filtering at each threshold, tag binding via `withTag`, field binding via `child`, non-mutation of the parent logger, Secret_Field redaction at top level and nested depth, and JSON-mode round-trip.
5. THE Test_Suite SHALL include one Integration_Boot_Test that starts the Server on an ephemeral port with a temporary working directory and asserts successful responses for at least `GET /api/now`, `GET /api/stations`, `GET /api/queue`, `GET /api/health`, and `GET /api/search?q=focus`.
6. THE `package.json` SHALL define a `test` script that runs `node --experimental-sqlite --test tests/`.
7. THE Check_Script SHALL run the Test_Suite after the syntax check, and the script SHALL exit non-zero if any test fails.
8. THE Smoke_Script (`scripts/smoke.js`) SHALL continue to pass unchanged against the refactored server.

### Requirement 10: Behavior Parity and Non-Goals

**User Story:** As a maintainer, I want the refactor to be a no-op for every user of the HTTP API, so that frontend and smoke-test expectations continue to hold.

#### Acceptance Criteria

1. FOR ALL Public_Endpoints, THE response status code for a given request SHALL equal the pre-refactor status code for the same request (behavior parity property).
2. FOR ALL Public_Endpoints that return JSON, THE Response_Shape of the response SHALL equal the pre-refactor Response_Shape for the same request, where equality is defined as same field names at every nesting depth, same value types, and same set membership for arrays treated as unordered collections when the pre-refactor implementation did not document an order.
3. THE Server SHALL continue to start with `node --experimental-sqlite server/index.js` and SHALL continue to accept `PORT` and `HOST` environment variables with the same defaults (`8080` and `0.0.0.0`).
4. THE Server SHALL NOT add new user-facing endpoints or remove existing ones as part of this feature.
5. THE Server SHALL NOT migrate `server/db.js` into per-domain repositories as part of this feature.
6. THE Server SHALL NOT change `web/app.js` or any file under `web/` as part of this feature.
7. THE Server SHALL NOT add runtime dependencies beyond those already listed in `package.json` unless the design document justifies the addition and the user approves it.

### Requirement 11: Configuration and Documentation

**User Story:** As a maintainer, I want the new env variables and module layout documented, so that the next person on the codebase can tune thresholds and add routes without reading every file.

#### Acceptance Criteria

1. THE `.env.example` file SHALL list every new environment variable introduced by this feature with a short comment describing its purpose and default value.
2. THE design document SHALL list every Route_Module and the Public_Endpoints it owns.
3. THE design document SHALL document the Circuit_Breaker state machine, including threshold, cool-down, retry count, and per-call timeout defaults per External_Client.
4. THE design document SHALL document the Secret_Field redaction list and the mechanism for extending it.
5. THE `README.md` SHALL reference the new `npm test` command and the location of the test suite.
