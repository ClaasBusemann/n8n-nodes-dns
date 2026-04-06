# Code Guidelines

Coding standards and patterns for this project. Each guideline includes
a rationale and good/bad examples.

---

## 1. Replace repetitive dispatch blocks with a lookup table

**Rationale:** When a function dispatches to different handlers based on a
combination of parameters, and every branch shares the same wrapper logic
(error handling, logging, return shape), the duplication adds noise and
makes it easy to introduce inconsistencies.

```typescript
// BAD — same 15-line wrapper copy-pasted per branch
if (type === 'a' && action === 'create') {
  try {
    const result = await createA(ctx, items);
    return [result];
  } catch (error) {
    if (ctx.continueOnFail()) {
      return [[{ json: { error: (error as Error).message } }]];
    }
    throw error;
  }
}
if (type === 'a' && action === 'delete') {
  // ... identical wrapper around deleteA()
}
// ... repeated N more times
```

```typescript
// GOOD — register handlers, dispatch once
type Handler = (ctx: Context, items: Item[]) => Promise<Item[]>;

const handlers: Record<string, Handler> = {
  'a:create': createA,
  'a:delete': deleteA,
  'b:update': updateB,
};

const key = `${type}:${action}`;
const handler = handlers[key];
if (!handler) throw new Error(`Unknown: ${key}`);

try {
  return [await handler(ctx, items)];
} catch (error) {
  if (ctx.continueOnFail()) {
    return [[{ json: { error: (error as Error).message } }]];
  }
  throw error;
}
```

Adding a new handler becomes a one-liner, and wrapper logic is guaranteed
consistent.

---

## 2. Keep switch/case and if/else chains as thin dispatchers

**Rationale:** A `switch` or `if/else` chain should only decide *which*
function to call — it should not contain the implementation itself. When
branches grow beyond a single function call, the dispatch logic becomes
hard to scan and each branch becomes hard to test in isolation.

```typescript
// BAD — logic inlined in every branch
switch (format) {
  case 'json': {
    const trimmed = body.trim();
    if (trimmed === '') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Invalid JSON: ${(err as Error).message}`);
    }
    if (Array.isArray(parsed)) return parsed;
    if (isObject(parsed)) return [parsed];
    throw new Error(`Expected array or object, got ${typeof parsed}`);
  }
  case 'csv': {
    // ... another 30 lines
  }
}
```

```typescript
// GOOD — switch only dispatches
switch (format) {
  case 'json':
    return parseJson(body);
  case 'csv':
    return parseCsv(body);
  default:
    throw new Error(`Unsupported format: ${format}`);
}
```

Each branch is one line. The actual logic lives in dedicated, individually
testable functions.

---

## 3. Break large functions into small, single-purpose helpers

**Rationale:** A function that handles input validation, data
transformation, and output formatting all at once is hard to read, test,
and reuse. Extract each concern into its own helper so that every function
does one thing.

```typescript
// BAD — one function doing parsing, validation, and mapping
function processResponse(body: string): Row[] {
  if (body.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(`Invalid: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed) && !isObject(parsed)) {
    throw new Error(`Expected array or object, got ${typeof parsed}`);
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const results: Row[] = [];
  for (const item of items) {
    // ... 20 more lines of field mapping
    results.push(mapped);
  }
  return results;
}
```

```typescript
// GOOD — each step is its own function
function deserialize(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`Invalid: ${(err as Error).message}`);
  }
}

function toArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value;
  if (isObject(value)) return [value];
  throw new Error(`Expected array or object, got ${typeof value}`);
}

function mapFields(raw: Record<string, unknown>): Row {
  // ... field mapping only
}

function processResponse(body: string): Row[] {
  if (body.trim() === '') return [];
  return toArray(deserialize(body)).map(mapFields);
}
```

The top-level function reads like a pipeline. Each helper is independently
testable and reusable.

---

## 4. Limit nesting depth — one level of abstraction per function

**Rationale:** Each function should operate at a single level of
abstraction. A loop inside a loop, or a conditional inside a conditional,
is a signal that the inner block deserves its own named function. Two
levels of nesting can be acceptable in simple cases; three or more is
always too deep. Deep nesting hides logic, makes branches hard to follow,
and is difficult to test without contrived setups.

```typescript
// BAD — three levels deep, mixing iteration with parsing and mapping
function parseBlocks(lines: string[]): Row[] {
  const results: Row[] = [];
  for (const block of splitBlocks(lines)) {         // level 1
    const headers = extractHeaders(block);
    for (let r = 1; r < block.length; r++) {         // level 2
      const fields = splitFields(block[r]);
      const row: Row = {};
      for (let c = 0; c < headers.length; c++) {     // level 3
        if (fields[c] === '') {                       // level 4
          row[headers[c]] = defaults[c] ?? '';
        } else {
          row[headers[c]] = coerce(fields[c], types[c]);
        }
      }
      results.push(row);
    }
  }
  return results;
}
```

```typescript
// GOOD — each function stays at one level of abstraction
function mapRow(fields: string[], headers: string[], types: string[], defaults: string[]): Row {
  const row: Row = {};
  for (let c = 0; c < headers.length; c++) {
    const value = fields[c] === '' ? (defaults[c] ?? '') : fields[c];
    row[headers[c]] = coerce(value, types[c]);
  }
  return row;
}

function parseBlock(block: string[]): Row[] {
  const headers = extractHeaders(block);
  return block.slice(1)
    .map((line) => mapRow(splitFields(line), headers, types, defaults));
}

function parseBlocks(lines: string[]): Row[] {
  return splitBlocks(lines).flatMap(parseBlock);
}
```

**Rule of thumb:** if you are about to write a third level of indentation
inside a function body, extract the inner logic into a helper instead.

---

## 5. Prefer well-named functions over comments

**Rationale:** A comment that restates what the next line of code does
adds noise without value — it can drift out of sync and trains readers to
skip comments entirely. When you feel the urge to explain *what* a block
does, extract it into a function whose name *is* the explanation. Reserve
comments for *why* — business rules, non-obvious constraints, or
workarounds that the code cannot express on its own.

```typescript
// BAD — comments that repeat what the code already says
// Escape special characters in the label
const escaped = label.replace(/ /g, '\\ ').replace(/,/g, '\\,');

// Build the query string from parameters
const queryString = Object.entries(params)
  .map(([k, v]) => `${k}=${v}`)
  .join('&');

// Append suffix if present
if (suffix !== undefined) {
  result += suffix;
}
```

```typescript
// GOOD — function names carry the intent, no comments needed
const escaped = escapeLabel(label);
const queryString = buildQueryString(params);

if (suffix !== undefined) {
  result += suffix;
}
```

```typescript
// GOOD — comment explains *why*, not *what*
// The API rejects dates before 1970, but some devices report
// epoch 0 as a "no data" sentinel — normalize to undefined.
const safeTimestamp = timestamp === 0 ? undefined : timestamp;
```

**Rule of thumb:** if a comment can be replaced by renaming a variable or
extracting a function, do that instead. Only comment when the *reason*
behind the code would surprise a reader.

---

## 6. No JSDoc blocks on internal code, no section dividers

**Rationale:** JSDoc (`/** ... */`) is valuable on public API surfaces
where consumers read generated documentation. On internal functions it
just adds vertical noise — the function name, parameter names, and types
already communicate the same information. Similarly, ASCII divider banners
are a sign that a file contains too many unrelated concerns. If you need
a divider to find your way around, the file should be split instead.

```typescript
// BAD — JSDoc that restates the signature
/**
 * Serialize a record into the wire format expected by the API.
 *
 * Format: `<name>[,<key>=<value>…] <field>=<value>[,…] [<timestamp>]`
 *
 * This is a **pure function** — no side-effects, no HTTP, no framework imports.
 */
function serialize(
  name: string,
  metadata: MetadataMap,
  fields: FieldMap,
  timestamp?: number,
): string { ... }
```

```typescript
// GOOD — the name and types speak for themselves
function serialize(
  name: string,
  metadata: MetadataMap,
  fields: FieldMap,
  timestamp?: number,
): string { ... }
```

```typescript
// BAD — dividers to separate sections within a file
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escape(value: string): string { ... }

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

function serialize(...): string { ... }
```

```typescript
// GOOD — if sections are distinct enough to need dividers,
// move them to separate modules instead
export function escape(value: string): string { ... }

// in another module:
import { escape } from './helpers/escape';
export function serialize(...): string { ... }
```

**Rule of thumb:** use JSDoc only on exported public API that external
consumers depend on. For everything else, let the code communicate
through names and types. If a module needs visual landmarks, it needs
fewer responsibilities — split it.

---

## 7. Don't duplicate helpers — extract and parameterize

**Rationale:** When the same helper appears in multiple places with only
a word or two changed, the duplicates will inevitably drift apart.
Extract the common logic into a shared utility and pass the differences
as parameters.

```typescript
// BAD — same function copy-pasted in multiple places,
// only "Database" / "Cache" / "Token" / "Table" differs
function rethrowIfNotFound(ctx: Context, error: unknown, name: string, i: number): never {
  if (isNotFoundError(error)) {
    throw new ApiError(ctx.getNode(), {
      message: `Database "${name}" not found`,
      description: `The database "${name}" does not exist.`,
    });
  }
  throw error;
}

// elsewhere — identical except "Cache"
function rethrowIfNotFound(ctx: Context, error: unknown, name: string, i: number): never {
  if (isNotFoundError(error)) {
    throw new ApiError(ctx.getNode(), {
      message: `Cache "${name}" not found`,
      description: `The cache "${name}" does not exist.`,
    });
  }
  throw error;
}
```

```typescript
// GOOD — one shared utility, callers pass the resource label
function rethrowIfNotFound(
  ctx: Context,
  error: unknown,
  resourceType: string,
  resourceName: string,
  itemIndex: number,
): never {
  if (isNotFoundError(error)) {
    throw new ApiError(ctx.getNode(), {
      message: `${resourceType} "${resourceName}" not found`,
      description: `The ${resourceType.toLowerCase()} "${resourceName}" does not exist.`,
    });
  }
  throw error;
}

// callers just pass the resource label
rethrowIfNotFound(ctx, error, 'Database', name, i);
rethrowIfNotFound(ctx, error, 'Cache', name, i);
```

**Rule of thumb:** if you are about to paste a function and change a
string literal, stop — extract it into a shared utility and make the
varying part a parameter.

---

## 8. Use an options object instead of long positional parameter lists

**Rationale:** When a function has more than 3–4 parameters, and callers
frequently pass `undefined` for unused middle arguments, it becomes hard
to read and easy to mix up positions. Use a named-options object for the
optional parameters so callers only specify what they need.

```typescript
// BAD — 7 positional args, callers pass placeholder undefineds
function apiRequest(
  ctx: Context,
  method: string,
  endpoint: string,
  body?: object,
  qs?: object,
  options?: RequestOptions,
  itemIndex?: number,
): Promise<unknown> { ... }

// caller — which undefined is qs and which is options?
await apiRequest(ctx, 'DELETE', '/api/resource', undefined, undefined, undefined, i);
```

```typescript
// GOOD — required args stay positional, everything else is named
interface ApiRequestOptions {
  body?: object;
  qs?: object;
  options?: RequestOptions;
  itemIndex?: number;
}

function apiRequest(
  ctx: Context,
  method: string,
  endpoint: string,
  opts?: ApiRequestOptions,
): Promise<unknown> { ... }

// caller — clean and self-documenting
await apiRequest(ctx, 'DELETE', '/api/resource', { itemIndex: i });
```

**Rule of thumb:** once a function exceeds 3 parameters, or callers
regularly skip middle arguments with `undefined`, switch to an options
object.

---

## 9. Share test utilities — don't inline mock factories

**Rationale:** When every test suite defines its own `createMockContext()`
or `capturedRequestOptions()`, the mocks subtly diverge over time and bug
fixes in one place don't propagate to others. Shared test helpers ensure
consistent mock behaviour and reduce boilerplate across tests.

```typescript
// BAD — mock factory duplicated across test suites
function createMockContext(params: MockParams) {
  return {
    getNodeParameter: jest.fn((name: string, i: number) => params[name]?.[i]),
    getNode: jest.fn(() => ({ name: 'TestNode' })),
    continueOnFail: jest.fn(() => false),
    // ... 30 more lines
  };
}

// elsewhere — same function, copy-pasted
function createMockContext(params: MockParams) { /* identical */ }

// yet another place — same again
function createMockContext(params: MockParams) { /* identical */ }
```

```typescript
// GOOD — single shared module, all tests import from it
export function createMockContext(options: MockContextOptions) { ... }
export function capturedRequestOptions(mock: jest.Mock) { ... }
export function makeHttpError(statusCode: number, body?: string) { ... }

// in each test suite:
import { createMockContext } from '...';
```

**Rule of thumb:** if two or more test suites need the same mock setup,
move it to a shared helper immediately — don't wait for a third copy.

---

## 10. Use descriptive variable names — no abbreviations or single letters

**Rationale:** Single-letter variables and ad-hoc abbreviations force the
reader to hold a mental mapping ("what was `s` again?"). A descriptive
name makes the code self-documenting and removes that burden. The small
cost of typing a longer name is paid once; the readability benefit is
paid on every read.

Well-known acronyms and initialisms that are standard in the domain
(e.g. `CSV`, `CRLF`, `URL`, `HTTP`, `SQL`) are fine — they *are* the
clear name.

```typescript
// BAD — single-letter names and unclear abbreviations
for (let i = 0; i < rows.length; i++) {
  const s = rows[i];
  const ts = s.split(',');
  const v = parseFloat(ts[1]);
  results.push({ t: ts[0], val: v });
}
```

```typescript
// GOOD — names describe what the value represents
for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
  const line = rows[rowIndex];
  const columns = line.split(',');
  const temperature = parseFloat(columns[1]);
  results.push({ timestamp: columns[0], value: temperature });
}
```

```typescript
// BAD — abbreviated parameter names
function fmt(m: string, t: Record<string, string>, f: Record<string, number>): string { ... }

// GOOD — intention is clear from the names
function format(measurement: string, tags: Record<string, string>, fields: Record<string, number>): string { ... }
```

**Exceptions:** Standard loop counters (`i`, `j`) are acceptable in
trivial loops where the body is a single expression and the index
carries no domain meaning:

```typescript
// OK — trivial loop, single expression, no ambiguity
for (let i = 0; i < items.length; i++) {
  output.push(transform(items[i]));
}
```

But once the loop body grows beyond a couple of lines or the index is
used for anything other than array access, give it a meaningful name.

**Rule of thumb:** if a reviewer would need to scroll up to understand
what a variable holds, the name is too short.

---

## 11. Scope eslint-disable to single lines with a justification

**Rationale:** A blanket `/* eslint-disable <rule> */` at file scope
silently suppresses warnings on every future line added to the file,
including lines that genuinely violate the rule. This hides new problems
and makes it unclear which lines actually need the suppression. Scoping
the disable to the exact line that needs it keeps the rest of the file
protected and forces the author to justify each exception.

```typescript
// BAD — blanket disable covers the entire file
/* eslint-disable @n8n/community-nodes/no-restricted-globals */

const timer = setTimeout(() => { ... }, timeout);
// ... 200 lines later, a new violation slips in unnoticed
```

```typescript
// GOOD — scoped to the single line that needs it, with a reason
// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- n8n has no timer API; needed for UDP socket timeout
const timer = setTimeout(() => { ... }, timeout);
```

**Rule of thumb:** always use `eslint-disable-next-line`, never
`eslint-disable`. Every suppression must include a `--` justification
comment explaining *why* the rule does not apply.

---

## 12. Keep functions under ~30 lines — extract when they grow

**Rationale:** Long functions accumulate multiple responsibilities and
deep nesting. A function that reads input, resolves configuration,
performs I/O, branches on results, formats output, and handles errors
is doing too many things. When a function exceeds roughly 30 lines of
logic (excluding type declarations and static configuration objects),
it almost always contains extractable steps that would be clearer as
named helpers. The same applies to nesting: if a function reaches 3+
levels of indentation (loop > try > if > if), the inner blocks should
be lifted into their own functions.

```typescript
// BAD — 80+ line function doing everything inline
async function handleItems(items: Item[]): Promise<Result[]> {
  const results: Result[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      const config = readConfig(items[i]);
      const targets = await resolveTargets(config);
      if (targets.length === 0) {
        throw new Error('no targets');
      }
      if (targets.length === 1) {
        const response = await fetchOne(targets[0], config);
        if (isWarning(response.status)) {           // level 4
          logWarning(response);
        }
        results.push(formatSingle(response));
      } else {
        const responses = await fetchAll(targets, config);
        for (const response of responses) {         // level 4
          validate(response);
        }
        const warnings = collectWarnings(responses);
        for (const warning of warnings) {           // level 4
          logWarning(warning);
        }
        results.push(formatMulti(responses));
      }
    } catch (error) {
      if (shouldContinue()) {
        results.push({ error: (error as Error).message });
        continue;
      }
      throw error;
    }
  }
  return results;
}
```

```typescript
// GOOD — top-level function is a thin loop, logic is in named helpers
async function handleItems(items: Item[]): Promise<Result[]> {
  const results: Result[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      results.push(await processItem(items[i]));
    } catch (error) {
      if (shouldContinue()) {
        results.push({ error: (error as Error).message });
        continue;
      }
      throw error;
    }
  }
  return results;
}

async function processItem(item: Item): Promise<Result> {
  const config = readConfig(item);
  const targets = await resolveTargets(config);
  if (targets.length === 0) throw new Error('no targets');
  return targets.length === 1
    ? await fetchAndFormatSingle(targets[0], config)
    : await fetchAndFormatMulti(targets, config);
}

async function fetchAndFormatSingle(target: Target, config: Config): Promise<Result> {
  const response = await fetchOne(target, config);
  if (isWarning(response.status)) logWarning(response);
  return formatSingle(response);
}

async function fetchAndFormatMulti(targets: Target[], config: Config): Promise<Result> {
  const responses = await fetchAll(targets, config);
  responses.forEach(validate);
  collectWarnings(responses).forEach(logWarning);
  return formatMulti(responses);
}
```

**Rule of thumb:** if you need to scroll to see an entire function, it
is too long. Extract named steps until each function fits on one screen
(~30 lines) and stays at 2 or fewer levels of nesting.
