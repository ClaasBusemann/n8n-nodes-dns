# n8n-nodes-dns — Design Document

## Overview

A zero-dependency n8n community node that performs raw DNS queries using the DNS wire protocol (RFC 1035). Unlike the Node.js built-in `dns` module, this node constructs and parses DNS packets directly over UDP, giving users control over which nameserver to query, access to full response metadata (TTL, authority section, authoritative flag), and the ability to query multiple resolvers in parallel for propagation checking.

The node ships as two components: a **DNS Lookup** action node and a **DNS Watch** trigger node.

**Package name:** `n8n-nodes-dns`
**License:** MIT
**n8n compatibility:** 1.0.0+
**Node.js built-ins used:** `dgram`, `crypto`, `fs`

## Motivation

There is no built-in or community n8n node for raw DNS queries. The Node.js built-in `dns` module — which n8n's Code node can access — delegates to the system resolver and abstracts away critical information:

- It does not allow specifying a target nameserver per query.
- It does not expose TTL values on returned records.
- It does not return the authority or additional sections of the DNS response.
- It cannot distinguish between authoritative and cached answers.
- It offers no way to query the same record against multiple resolvers in parallel.

These limitations make it impossible to build propagation checks, email security monitoring, DNSBL lookups, or authoritative verification workflows using the built-in module. Users currently work around this with multi-node workarounds:

- **Execute Command + `dig`** — shelling out to `dig` and parsing text output. Fragile, unavailable in many n8n environments (including Cloud), and produces unstructured text.
- **HTTP Request + Google DoH** — querying Google's DNS-over-HTTPS endpoint (`dns.google/resolve`) via the HTTP Request node. The most popular existing approach (see n8n workflow template #10200), but requires 7+ nodes (Form trigger, IF, Split Out, Loop, HTTP Request, Code, Aggregate) to do what should be a single operation. It is locked to a single resolver (Google), offers no multi-server propagation checking, no authoritative discovery, no TXT record parsing, and breaks if Google changes their response format.
- **Third-party APIs** — paid services like uProc that perform DNS lookups on their infrastructure and return results via HTTP. Requires credentials, costs money, and gives no control over which resolver is queried.

The existence of these workarounds — particularly the DoH workflow's popularity — validates the demand. A dedicated node that speaks the wire protocol directly fills this gap with structured JSON output, multi-server support, TXT record parsing, and zero dependencies, in a single node.

## Design Principles

**Zero external dependencies.** The node uses only `n8n-workflow` APIs and Node.js built-ins. DNS is a binary protocol over UDP — `dgram` for transport, `crypto` for transaction IDs, and `Buffer` for packet encoding/decoding are all that's needed. This keeps the package small, eliminates supply chain risk, and meets the n8n verification requirement that verified community nodes must have no runtime dependencies.

**Wire protocol, not system resolver.** The entire point of this node is to bypass the system resolver. Every query is a raw UDP packet sent to a specific IP address on port 53. This gives the user full control over which server answers and full visibility into the response.

**Programmatic node style.** n8n offers declarative and programmatic node building approaches. Declarative is designed for straightforward REST CRUD with routing configuration. This node requires programmatic style for three reasons: the transport layer is UDP, not HTTP; response parsing requires decoding a binary wire format into structured JSON; and multi-server queries require parallel dispatch with aggregated output.

**Single Responsibility Principle.** Every file has one job. The node class is a thin router. Packet encoding, packet decoding, name compression, RDATA parsing, TXT format parsing, and UDP transport each live in dedicated modules. No file both constructs a packet and sends it.

**Solid defaults, full control.** A basic lookup (domain + record type) requires two parameters. Advanced options (custom servers, timeout, retry, recursion flag) are available under a collapsed Options section, following n8n's established UX pattern.

## Scaffolding and Tooling

The project will be scaffolded using the `@n8n/node-cli`:

```
npm create @n8n/node
```

This generates the correct project structure, TypeScript configuration, ESLint rules (including `eslint-plugin-n8n-nodes-base`), and build tooling. Using the CLI is strongly recommended by n8n for any node submitted for verification and ensures linter compliance from the start.

The project will include a GitHub Actions workflow (`.github/workflows/publish.yml`) for publishing to npm with provenance attestation, which becomes mandatory for verified community nodes on May 1, 2026.

### justfile

All development commands are run via a `justfile`. Running `just` with no arguments lists available recipes.

```just
# justfile

# List all available recipes
default:
    @just --list

# ── Build ─────────────────────────────────────────────────────────────────────

# Compile TypeScript → dist/
build:
    npm run build

# Watch mode for development (starts local n8n instance with node loaded)
dev:
    npm run dev

# ── Code quality ──────────────────────────────────────────────────────────────

# Run n8n node linter
lint:
    npm run lint

# Run linter and auto-fix
lint-fix:
    npm run lint:fix

# Run Prettier formatter
format:
    npx prettier --write "src/**/*.ts" "test/**/*.ts"

# Check formatting without writing (for CI)
format-check:
    npx prettier --check "src/**/*.ts" "test/**/*.ts"

# ── Tests ─────────────────────────────────────────────────────────────────────

# Run unit tests only
test-unit:
    npx jest --testPathPatterns="test/unit"

# Run integration tests (requires network access)
test-int:
    RUN_INTEGRATION_TESTS=1 npx jest --testPathPatterns="test/integration"

# Run unit + integration (default CI suite)
test:
    npx jest --testPathPatterns="test/unit|test/integration"

# Run unit + integration tests with coverage enforcement
test-coverage:
    npx jest --testPathPatterns="test/unit|test/integration" --coverage

# Run e2e tests (requires network access)
test-e2e:
    RUN_INTEGRATION_TESTS=1 npx jest --testMatch="**/test/e2e/**/*.test.ts"

# Run all tests including e2e
test-all:
    RUN_INTEGRATION_TESTS=1 npx jest --testMatch="**/test/**/*.test.ts"

# ── Verification ──────────────────────────────────────────────────────────────

# Run @n8n/scan-community-package locally (local replica of verification gate)
verify:
    node verify.mjs

# Full pre-publish check: lint + format-check + test-coverage + build + verify
check: lint format-check test-coverage build verify
    @echo "All checks passed."
```

Key differences from a typical project: integration and e2e recipes set `RUN_INTEGRATION_TESTS=1` to gate network-dependent tests, and the format globs target `src/**/*.ts` (matching the `src/` project layout) rather than top-level `nodes/` and `credentials/` directories.

## Use Cases

### DNS Propagation Monitoring

After changing a DNS record, query multiple public resolvers in parallel and compare answers to the authoritative nameserver. Fire a workflow only when all resolvers return the new value.

### Domain and Brand Monitoring

Periodically resolve a list of typosquat candidates (e.g. `mybrandd.com`, `my-brand.io`). Alert when a previously non-existent domain begins resolving.

### Email Security Monitoring

Query TXT records for `_dmarc.example.com`, `example.com` (SPF), and `_domainkey.example.com` (DKIM selectors). Alert if policies weaken — for example, DMARC changing from `p=reject` to `p=none`. The node parses SPF and DMARC records into structured objects, making field-level comparisons trivial in downstream IF nodes.

### DNSBL / Blocklist Checking

Check whether a mail server IP is listed on DNS-based blocklists by querying the reversed IP against DNSBL zones (e.g. `1.2.0.192.zen.spamhaus.org`). Run across multiple blocklists in a single execution.

### TXT Record Verification for SaaS Onboarding

Poll for a specific TXT record on a customer's domain to verify ownership. Automatically activate the customer's account when the record appears.

### Infrastructure Service Discovery

Query SRV records to discover services and their ports, priorities, and weights. Monitor for disappearing services or changes in routing priority.

### Certificate Authority Authorization

Query CAA records to audit which CAs are permitted to issue certificates for a domain. Alert on unauthorized changes.

---

## Node Structure

### Package Layout

```
n8n-nodes-dns/
├── src/
│   ├── nodes/
│   │   ├── DnsLookup/
│   │   │   ├── DnsLookup.node.ts          # Action node
│   │   │   └── DnsLookup.node.json        # Codex metadata
│   │   └── DnsWatch/
│   │       ├── DnsWatch.node.ts            # Trigger (polling) node
│   │       └── DnsWatch.node.json          # Codex metadata
│   ├── credentials/
│   │   └── DnsServerApi.credentials.ts     # Saved server presets
│   ├── transport/
│   │   ├── dns-client.ts                   # UDP query engine
│   │   ├── dns-packet.ts                   # Wire format encode/decode
│   │   └── dns-resolvers.ts                # Well-known resolver registry
│   └── utils/
│       ├── name-compression.ts             # DNS name compression codec
│       ├── record-parsers.ts               # RDATA parsers per record type
│       ├── txt-parsers.ts                  # SPF/DMARC/DKIM/verification parsers
│       └── authoritative-discovery.ts      # NS delegation chain walker
├── test/
│   ├── unit/
│   │   ├── dns-packet.test.ts
│   │   ├── name-compression.test.ts
│   │   ├── record-parsers.test.ts
│   │   ├── txt-parsers.test.ts
│   │   └── authoritative-discovery.test.ts
│   ├── integration/
│   │   ├── dns-client.test.ts
│   │   └── resolver-queries.test.ts
│   └── e2e/
│       ├── lookup-node.test.ts
│       └── watch-node.test.ts
├── package.json
├── tsconfig.json
├── justfile                                 # Task runner (see Scaffolding and Tooling)
├── verify.mjs                               # Local replica of @n8n/scan-community-package
├── LICENSE                                  # MIT
└── README.md
```

### File Responsibilities

**`DnsLookup.node.ts`** — The action node class. Defines the `description` (parameters, display options) and implements `execute()` as a loop over input items that reads parameters, delegates to the DNS client, and wraps results in `INodeExecutionData[]`. Contains no packet encoding, no parsing, no UDP logic.

**`DnsWatch.node.ts`** — The polling trigger node class. Implements `poll()` which calls the same DNS client as the action node, compares results against state persisted via `this.getWorkflowStaticData('node')`, and returns items only when the configured condition is met. Contains no packet encoding, no parsing, no UDP logic.

**`DnsServerApi.credentials.ts`** — Credential definition. Stores a server address and port for reuse across workflows. Not authentication — DNS has no auth — but follows the n8n pattern of externalizing configuration.

**`dns-client.ts`** — The single point of contact with the network. Creates `dgram` UDP sockets, sends encoded packets, listens for responses, handles timeouts and retries. All node-level code calls this module instead of touching `dgram` directly.

**`dns-packet.ts`** — Pure functions. Encodes a query config object into a `Buffer` and decodes a response `Buffer` into a structured object. No I/O, no side effects. Independently testable with static fixtures.

**`dns-resolvers.ts`** — Pure data. Exports a constant registry of well-known public DNS resolvers with their IPs and names. Also exports a function that reads `/etc/resolv.conf` for the System resolver mode.

**`name-compression.ts`** — Pure function. Decompresses DNS name pointer chains in response packets. Enforces recursion depth limit and maximum name length.

**`record-parsers.ts`** — Pure functions. Parses RDATA bytes for each supported record type into structured objects. Registered in a type map, dispatched by TYPE field.

**`txt-parsers.ts`** — Pure functions. Chain of detection functions that test raw TXT values against known formats (SPF, DMARC, DKIM, verification tokens) and return structured parsed objects. Short-circuits on first match.

**`authoritative-discovery.ts`** — Uses the DNS client to walk the NS delegation chain for a domain, returning the authoritative nameserver IPs. Optimizes by using glue records from the additional section when available.

### Architectural Constraint — File I/O

The n8n verification guidelines state that nodes must not attempt to read or write files. This node has one controlled exception: reading `/etc/resolv.conf` in the System resolver mode. This is a read-only operation on a system configuration file, not a user-data file, and is equivalent to what the Node.js `dns` module itself does internally. The functionality is isolated in `dns-resolvers.ts` and only invoked when the user explicitly selects System mode.

---

## Credentials

**File:** `credentials/DnsServerApi.credentials.ts`

The credential stores connection configuration for a reusable DNS server. The credential `name` is `dnsServerApi`, ending with `Api` as required by the n8n linter.

| Field | Type | Required | Description |
|---|---|---|---|
| `server` | string | yes | IP address or hostname of the DNS server |
| `port` | number | no | UDP port. Default: 53 |

DNS has no authentication mechanism, so there is no token or password field. The credential exists purely for configuration reuse — users who query the same internal DNS server across multiple workflows can save it once.

There is no credential test block. Unlike HTTP APIs, there is no equivalent of `GET /health` for DNS — any query to a DNS server is effectively a connectivity test. The node will surface connection failures clearly at execution time.

---

## DNS Lookup Node (Action)

The node's `displayName` is **DNS Lookup**. The internal class name is `DnsLookup`, and the node `name` is `dnsLookup`. Because the node has a single purpose (performing DNS queries) rather than multiple resources/operations, it does not use the `resource`/`operation` pattern.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| Domain | String (expression-enabled) | The domain name to query. Supports expressions for per-item resolution. |
| Record Type | Options | A, AAAA, MX, TXT, SRV, PTR, CAA, SOA, NS, CNAME, NAPTR, DNSKEY, TLSA |
| Resolver Mode | Options | Well-Known, Custom, Authoritative (auto-discover), System |
| Well-Known Resolvers | Multi-select | Cloudflare, Google, Quad9, OpenDNS, AdGuard, Control D (visible when Resolver Mode = Well-Known) |
| Custom Servers | Collection | Repeatable IP/port pairs (visible when Resolver Mode = Custom) |
| Timeout | Number | Per-query timeout in milliseconds. Default: 5000 |
| Retry Count | Number | Number of retries on timeout. Default: 1 |
| Recursion Desired | Boolean | Set the RD flag. Default: true |
| Output Consistency Check | Boolean | Add `consistent` and `propagated` fields to output. Default: true when querying multiple servers |

The Record Type and Resolver Mode parameters set `noDataExpression: true` since they control node behavior and must not be expression-dependent.

**Runtime execution flow:**

```
execute()
    │
    ├─ getInputData()
    │
    ├─ for each item i:
    │   ├─ getNodeParameter('domain', i)
    │   ├─ getNodeParameter('recordType', i)
    │   ├─ resolveTargetServers(resolverMode, i)
    │   │       Well-Known  → lookup from static registry
    │   │       Custom      → read from collection parameter
    │   │       Authoritative → walkDelegationChain(domain)
    │   │       System      → parseResolvConf('/etc/resolv.conf')
    │   │
    │   ├─ Promise.allSettled(servers.map(s => dnsQuery(domain, type, s)))
    │   │
    │   ├─ parseResponses(rawBuffers)
    │   │       decode packet → parse RDATA per type → parse TXT if applicable
    │   │
    │   ├─ if multiServer: computeConsistencyFlags(responses)
    │   │
    │   └─ constructExecutionMetaData(outputItem, { itemData: { item: i } })
    │
    └─ return [returnData]
```

---

## DNS Watch Node (Trigger)

A polling trigger that checks a DNS record at a configurable interval and fires the workflow when the answer changes.

**Parameters:**

All parameters from the Lookup node, plus:

| Parameter | Type | Description |
|-----------|------|-------------|
| Poll Interval | Number | Polling frequency in minutes. Minimum: 1. Default: 5 |
| Fire On | Options | "Any Change", "Record Appears", "Record Disappears", "Value Matches" |
| Expected Value | String | For "Value Matches" mode — fire when the answer equals this value |

**State management:**

The trigger persists the previous answer set using `this.getWorkflowStaticData('node')`. On each poll it compares the new answer to the stored state and fires only when the configured condition is met.

---

## Transport Layer

### Wire Format (dns-packet.ts)

The DNS wire protocol is defined in RFC 1035 §4. Each message consists of a fixed 12-byte header followed by variable-length question, answer, authority, and additional sections.

**Header layout (12 bytes, fixed):**

```
 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      ID                       |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|QR| Opcode  |AA|TC|RD|RA| Z    |    RCODE      |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    QDCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    ANCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    NSCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    ARCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

The encoder builds a query packet from a domain name, record type, and flags. The decoder parses a response buffer into a structured object. Both operate entirely on `Buffer` using `readUInt16BE`, `writeUInt16BE`, and slice operations.

Key implementation details:

- **Transaction ID** — 2 random bytes via `crypto.randomBytes(2)` to match requests with responses.
- **Label encoding** — domain names are encoded as a sequence of length-prefixed labels terminated by a zero byte (e.g. `example.com` becomes `0x07 "example" 0x03 "com" 0x00`).
- **Name compression** — response packets may contain pointers (two bytes with the high two bits set to `11`) that reference earlier positions in the packet. The decompressor follows pointer chains with a recursion limit to prevent malicious loops.
- **RDATA parsing** — each record type has a specific binary layout. Parsers are registered in a type map and dispatch based on the TYPE field of each resource record.

The encode and decode functions are pure — they take a config object or buffer and return a result. No I/O, no side effects.

### UDP Client (dns-client.ts)

The client manages UDP socket lifecycle, timeouts, retries, and parallel dispatch to multiple servers.

Each query creates a `dgram` UDP4 socket, sends the encoded packet, and listens for a response matching the transaction ID. On timeout, the socket is closed and the query retried up to the configured limit. When querying multiple servers, all queries are dispatched concurrently using `Promise.allSettled()` so that a slow or failing server does not block others.

If the response has the TC (truncated) flag set, the node includes a `truncated: true` flag in the output but does not fall back to TCP in v1. TCP fallback is a v2 enhancement.

### Authoritative Discovery (authoritative-discovery.ts)

When the user selects "Authoritative (auto-discover)" resolver mode, the node walks the DNS delegation chain:

1. Query any recursive resolver for the NS records of the target domain.
2. Extract nameserver hostnames from the answer section.
3. Resolve each nameserver hostname to an IP address (A record query).
4. Return the list of IPs as query targets.

If the NS response includes glue records in the additional section (A records for the nameserver hostnames), the second resolution step is skipped.

### Well-Known Resolvers (dns-resolvers.ts)

A static registry of public DNS resolvers. Stored as a constant — no external data fetching.

| Name | Primary | Secondary | Notes |
|------|---------|-----------|-------|
| Cloudflare | 1.1.1.1 | 1.0.0.1 | Fastest average response time |
| Google | 8.8.8.8 | 8.8.4.4 | Widest adoption |
| Quad9 | 9.9.9.9 | 149.112.112.112 | Malware blocking enabled |
| Quad9 Unfiltered | 9.9.9.10 | 149.112.112.10 | No filtering |
| OpenDNS | 208.67.222.222 | 208.67.220.220 | Cisco-operated |
| Cloudflare Malware | 1.1.1.2 | 1.0.0.2 | Malware blocking |
| Cloudflare Family | 1.1.1.3 | 1.0.0.3 | Malware + adult content blocking |
| AdGuard | 94.140.14.14 | 94.140.15.15 | Ad blocking |
| Control D | 76.76.2.0 | 76.76.10.0 | Configurable filtering |

The "System" resolver mode reads nameservers from `/etc/resolv.conf` by parsing lines starting with `nameserver`. This works in Docker containers, which inherit the host's resolver configuration.

---

## Output Format

### Single Server Response

When querying a single server, each input item produces one output item:

```json
{
  "domain": "example.com",
  "type": "A",
  "server": "1.1.1.1",
  "serverName": "Cloudflare",
  "authoritative": false,
  "responseCode": "NOERROR",
  "responseTimeMs": 12,
  "answers": [
    { "name": "example.com", "type": "A", "ttl": 3542, "value": "93.184.216.34" }
  ],
  "authority": [],
  "additional": []
}
```

### Multi-Server Response

When querying multiple servers, the output is one combined item per input item, containing a `results` array and top-level consistency flags. Users who need per-server items can use a downstream Split Out node on the `results` array.

```json
{
  "domain": "example.com",
  "type": "A",
  "results": [
    { "server": "1.1.1.1", "serverName": "Cloudflare", "answers": [], "responseTimeMs": 12 },
    { "server": "8.8.8.8", "serverName": "Google", "answers": [], "responseTimeMs": 18 },
    { "server": "198.51.100.1", "serverName": "ns1.example.com (authoritative)", "answers": [] }
  ],
  "consistent": true,
  "propagatedToAll": true,
  "serverCount": 3,
  "uniqueAnswers": 1
}
```

`consistent` is `true` when all servers return identical answer values (ignoring TTL differences). `propagatedToAll` is `true` when all non-authoritative answers match the authoritative answer. These flags are designed to feed directly into downstream IF nodes.

### Record Type Value Formats

Each record type produces a specific `value` structure in the answers array:

| Type | Value Format |
|------|-------------|
| A | `"93.184.216.34"` |
| AAAA | `"2606:2800:220:1:248:1893:25c8:1946"` |
| MX | `{ "priority": 10, "exchange": "mail.example.com" }` |
| TXT | `{ "raw": "v=spf1 include:...", "parsed": { ... } }` (see TXT Record Parsing) |
| SRV | `{ "priority": 10, "weight": 60, "port": 5060, "target": "sip.example.com" }` |
| SOA | `{ "mname": "...", "rname": "...", "serial": 2024010101, ... }` |
| NS | `"ns1.example.com"` |
| CNAME | `"alias.example.com"` |
| PTR | `"host.example.com"` |
| CAA | `{ "flags": 0, "tag": "issue", "value": "letsencrypt.org" }` |
| NAPTR | `{ "order": 10, "preference": 100, "flags": "s", "service": "SIP+D2U", ... }` |

### TXT Record Parsing

When the queried record type is TXT, the node returns both the raw string value and a `parsed` object with structured fields. Parsing is best-effort — if a TXT record does not match any known format, `parsed` is `null` and the raw value is still available.

**SPF** — detected by the `v=spf1` prefix:

```json
{
  "raw": "v=spf1 ip4:192.0.2.0/24 include:_spf.google.com -all",
  "parsed": {
    "type": "spf",
    "version": "spf1",
    "mechanisms": [
      { "qualifier": "+", "type": "ip4", "value": "192.0.2.0/24" },
      { "qualifier": "+", "type": "include", "value": "_spf.google.com" },
      { "qualifier": "-", "type": "all", "value": null }
    ]
  }
}
```

SPF mechanisms are parsed into an array preserving order and qualifier (`+` pass, `-` fail, `~` softfail, `?` neutral). The default qualifier is `+` when omitted.

**DMARC** — detected by the `v=DMARC1` prefix, queried at `_dmarc.<domain>`:

```json
{
  "raw": "v=DMARC1; p=reject; rua=mailto:dmarc@example.com; pct=100",
  "parsed": {
    "type": "dmarc",
    "version": "DMARC1",
    "policy": "reject",
    "subdomainPolicy": null,
    "percentage": 100,
    "reportAggregate": ["mailto:dmarc@example.com"],
    "reportForensic": [],
    "alignmentDkim": "relaxed",
    "alignmentSpf": "relaxed"
  }
}
```

DMARC tags are parsed into named fields. Missing optional tags are populated with their RFC 7489 defaults (e.g. `adkim` and `aspf` default to `relaxed`, `pct` defaults to 100).

**DKIM** — detected by the `v=DKIM1` prefix, queried at `<selector>._domainkey.<domain>`:

```json
{
  "raw": "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4...",
  "parsed": {
    "type": "dkim",
    "version": "DKIM1",
    "keyType": "rsa",
    "publicKey": "MIGfMA0GCSqGSIb3DQEBAQUAA4...",
    "hashAlgorithms": ["sha256"],
    "serviceTypes": ["*"],
    "flags": []
  }
}
```

**Domain verification tokens** — detected by common prefixes:

```json
{
  "raw": "google-site-verification=abc123...",
  "parsed": { "type": "verification", "provider": "google", "token": "abc123..." }
}
```

Known prefixes: `google-site-verification=`, `facebook-domain-verification=`, `MS=` (Microsoft 365), `atlassian-domain-verification=`, `apple-domain-verification=`, `_github-pages-challenge-`, `stripe-verification=`, `postmark-verification=`. Maintained as a simple prefix→provider map, easy to extend.

**Unrecognized TXT records** return `"parsed": null`.

The parser is implemented in `txt-parsers.ts` as a chain of detection functions. Each function tests whether the raw value matches its format and returns a parsed object or `null`. The chain is evaluated in order and short-circuits on the first match. Malformed records (correct prefix but invalid body) return `parsed: null` with a `parseError` string field rather than crashing.

---

## Item Linking

Because this is a programmatic-style node, n8n does not automatically track item provenance. The node must set `pairedItem` on every output item to maintain the link chain that enables expressions like `$('DNS Lookup').item` in downstream nodes.

The rules:

- **Single-server lookup (1 input → 1 output per item):** Each output item contains the query result for the corresponding input item. Output item at index `i` sets `pairedItem: { item: i }`.

- **Multi-server lookup (1 input → 1 combined output per item):** The combined results object for input item `i` sets `pairedItem: { item: i }`. Despite querying N servers, the output is one item per input item.

- **Watch trigger (0 inputs → 1 output):** Trigger outputs are not derived from input items. The output sets `pairedItem: { item: 0 }`.

All output items are wrapped with `this.helpers.constructExecutionMetaData()` which handles the `pairedItem` assignment and ensures compatibility with n8n's item tracking system.

---

## Error Handling

### DNS-Level Errors

DNS response codes are returned as structured data, not thrown as exceptions. The output includes a `responseCode` field with the standard code name. This allows downstream nodes to branch on error conditions.

| Response Code | Meaning | Node Behavior |
|---------------|---------|---------------|
| NOERROR | Success (may have 0 answers) | Normal output |
| NXDOMAIN | Domain does not exist | Normal output — critical for "domain appears" monitoring |
| SERVFAIL | Server failure | Normal output with warning |
| REFUSED | Query refused | Normal output with warning |
| FORMERR | Malformed query | Throw `NodeOperationError` — indicates a bug |

NXDOMAIN is explicitly not an error. Monitoring whether a domain exists or not is a first-class use case.

### Transport-Level Errors

| Error | Handling |
|-------|----------|
| Timeout | Retry up to configured limit, then return item with `responseCode: "TIMEOUT"` |
| Network unreachable | Throw `NodeOperationError` with descriptive message |
| Truncated response (TC flag) | Return partial data with `truncated: true` flag |

### Continue on Fail

The node respects `this.continueOnFail()`. When enabled, transport errors produce an output item with the error message rather than halting the workflow. DNS-level errors (NXDOMAIN, SERVFAIL) always produce structured output regardless of this setting.

---

## The Codex File

Each node requires a `.node.json` codex file that provides metadata for search, categorization, and documentation links. This file is required by the linter.

**`DnsLookup.node.json`:**

- `node` — `"DnsLookup"`
- `nodeVersion` — `"1.0"`
- `codexVersion` — `"1.0"`
- `categories` — `["Utility"]`
- `alias` — `["dns", "domain", "nameserver", "nslookup", "dig", "whois", "propagation", "dnsbl", "spf", "dmarc", "dkim", "mx", "txt", "cname", "srv"]`
- `resources.primaryDocumentation` — link to the README
- `subcategories.Utility` — `["DNS"]`

**`DnsWatch.node.json`:**

Same structure with `node` set to `"DnsWatch"` and additional aliases: `["dns watch", "dns monitor", "dns trigger", "domain monitor", "propagation check"]`.

---

## n8n Linter Compliance

The node will pass `eslint-plugin-n8n-nodes-base` in strict mode. Key rules the design explicitly satisfies:

- **`node-param-operation-without-no-data-expression`** — Record Type and Resolver Mode set `noDataExpression: true`.
- **`node-param-description-missing-from-dynamic-options`** — All options include descriptions.
- **`node-param-default-missing`** — All parameters have explicit defaults.
- **`node-param-display-name-miscased`** — Display names use Title Case.
- **`cred-class-field-name-missing-api`** — Credential `name` is `dnsServerApi`, ending with `Api`.
- **`community-package-json-name-still-default`** — Package name is `n8n-nodes-dns`, not the starter default.

The Lookup node does not use the `resource`/`operation` pattern (it has a single purpose), so `node-class-description-missing-subtitle` is satisfied with a static subtitle: `subtitle: '={{$parameter["recordType"] + " lookup"}}'`.

---

## Testing Strategy

### Approach

The test suite is structured in three layers. Unit tests cover every pure module in isolation. Integration tests perform real DNS queries over the network. E2E tests run the full node within the n8n execution context. The codebase is well-suited to test-first development — packet encoding, RDATA parsing, and TXT parsing are pure functions with narrow contracts.

Recommended TDD order:

1. `name-compression.ts` — pure, no dependencies
2. `dns-packet.ts` — pure, depends on name-compression
3. `record-parsers.ts` — pure, depends on name-compression
4. `txt-parsers.ts` — pure, no dependencies
5. `authoritative-discovery.ts` — mock dns-client
6. `dns-client.ts` — mock dgram
7. `DnsLookup.node.ts` — mock all helpers, test parameter wiring and output shape
8. `DnsWatch.node.ts` — mock all helpers, test state comparison logic

### Unit Tests

**Framework:** Jest with `ts-jest`

**dns-packet.ts:**

- Encode a query for every supported record type; assert exact byte sequences against reference packets captured from `dig` via `tcpdump`
- Decode reference response packets (static hex buffers) and assert correct parsing of all sections
- Round-trip: encode → decode → compare to original input
- Edge cases: maximum-length labels (63 bytes), maximum-length domain names (253 bytes), empty question section, zero-answer responses

**name-compression.ts:**

- Decompress pointers at various packet offsets
- Handle chained pointers (pointer → name containing another pointer)
- Detect and reject pointer loops (recursion depth > 10)
- Handle names at end of packet without compression

**record-parsers.ts:**

- Parse RDATA for each supported record type from known byte sequences
- MX: priority extraction and exchange name decompression
- SRV: all four fields (priority, weight, port, target)
- TXT: multiple character strings within a single record
- SOA: all seven fields
- CAA: flags, tag length, tag, value
- Malformed RDATA: truncated buffer, length mismatch — assert graceful error rather than crash

**txt-parsers.ts:**

- SPF: parse mechanisms with all qualifier types (`+`, `-`, `~`, `?`), `ip4`, `ip6`, `include`, `a`, `mx`, `all`, `redirect`, `exists`
- SPF: default qualifier is `+` when omitted
- SPF: multiple mechanisms in a single record
- DMARC: parse all tags (`p`, `sp`, `rua`, `ruf`, `adkim`, `aspf`, `pct`, `fo`, `rf`, `ri`)
- DMARC: missing optional tags filled with RFC 7489 defaults
- DMARC: multiple `rua`/`ruf` URIs separated by commas
- DKIM: parse key type, public key, hash algorithms, service types, flags
- DKIM: handle multi-string TXT records (DKIM keys often span multiple 255-byte strings)
- Verification tokens: match each known provider prefix and extract the token
- Unrecognized TXT: return `parsed: null` without error
- Malformed SPF/DMARC/DKIM (correct prefix, invalid body): return `parsed: null` with `parseError` field rather than crashing

**authoritative-discovery.ts:**

- Mock DNS client returns staged NS and A responses
- Verify correct two-step delegation chain walk
- Verify glue record optimization (skip A query when additional section has IPs)
- Handle failed NS lookups gracefully

**Fixture generation:** Reference packets captured once from real servers using `dig +noedns example.com A @1.1.1.1` and stored as hex strings. This validates against real-world formats rather than self-referential encode/decode cycles.

### Integration Tests

Perform actual DNS queries over the network. Validate that transport and parsing work against real servers.

**dns-client.ts:**

- Query `example.com A` against `1.1.1.1` — verify valid response
- Query non-existent subdomain — verify NXDOMAIN response code
- Query unreachable server IP — verify timeout behavior and retry
- Query multiple servers in parallel — verify all responses collected
- Verify transaction ID matching between request and response

**resolver-queries.ts:**

- Query each well-known resolver for a stable domain — verify valid answers
- Authoritative discovery for a known domain — verify returned nameserver IPs
- System resolver mode — verify `/etc/resolv.conf` parsing and query execution
- Query `_dmarc.google.com TXT` — verify raw value returned and DMARC parsed correctly
- Query `google.com TXT` — verify SPF record detected and mechanisms parsed

**Environment:** Gated behind `RUN_INTEGRATION_TESTS=1`. Idempotent and read-only. Excluded in CI environments without outbound UDP.

### End-to-End Tests

Validate the complete node within the n8n execution context using `n8n-core` test helpers (mocking `IExecuteFunctions`).

**lookup-node.test.ts:**

- Configure with domain and record type, execute, verify output schema matches the Output Format section
- Expression resolution: input `{ "domain": "example.com" }` with parameter `{{ $json.domain }}`
- Multi-server mode: select three resolvers, verify `results` array and consistency flags
- `continueOnFail`: unreachable server with continue enabled — verify error in output, no throw
- Each supported record type against a domain known to have that record
- TXT query with SPF record — verify output contains both `raw` and `parsed` with correct structure

**watch-node.test.ts:**

- Two polls with identical response — trigger does not fire on second poll
- Poll where answer changes — trigger fires with new data
- "Record Appears" mode: NXDOMAIN → A record — trigger fires
- Verify `getWorkflowStaticData` persistence between polls

### Test Infrastructure

Test commands are run via the justfile (see Scaffolding and Tooling). The relevant recipes are `just test-unit`, `just test-int`, `just test-e2e`, and `just test-coverage`.

| Concern | Approach |
|---------|----------|
| Test runner | Jest with `ts-jest` |
| Unit mocking | Custom mock wrapping `dgram.createSocket`, responds with fixture buffers |
| Network test gate | `RUN_INTEGRATION_TESTS=1` (set automatically by `just test-int` and `just test-e2e`) |
| CI pipeline | `just test` on every commit (unit + integration); `just test-all` on PR merge |
| Pre-publish | `just check` — runs lint + format-check + test-coverage + build + verify |
| Linting | `just lint` — `eslint-plugin-n8n-nodes-base` in strict mode |
| Formatting | `just format-check` in CI; `just format` for local auto-fix |
| Coverage target | 90%+ line coverage on `transport/` and `utils/`; 80%+ overall |

---

## Performance Considerations

- **Parallel queries:** dispatched simultaneously via `Promise.allSettled()` — wall-clock time equals the slowest server, not the sum.
- **Socket lifecycle:** one UDP socket per query, created and destroyed. UDP socket creation is lightweight; pooling deferred to v2 for batch workloads.
- **Payload size:** 512 bytes max without EDNS0. No EDNS0 OPT records in v1 — acceptable for single-record lookups. EDNS0 deferred to v2.
- **Rate awareness:** documentation will advise spreading bulk operations across multiple resolvers.

---

## Security Considerations

- **No credential exposure:** DNS queries are unencrypted UDP; the node transmits no secrets.
- **Network access:** UDP to user-specified IPs on port 53. n8n's existing environment-level egress restrictions apply.
- **Transaction ID validation:** responses with mismatched IDs are discarded (mitigates blind spoofing).
- **Compression safety:** max recursion depth 10, max name length 255 bytes (prevents DoS via crafted packets).

---

## Scope Boundaries

**In scope for v1.0:**

- DNS Lookup action node and DNS Watch polling trigger node.
- All record types listed in the parameters table (A, AAAA, MX, TXT, SRV, PTR, CAA, SOA, NS, CNAME, NAPTR, DNSKEY, TLSA).
- Raw DNS wire protocol over UDP using Node.js built-ins only.
- Multi-server parallel queries with consistency/propagation flags.
- Authoritative nameserver auto-discovery via NS delegation chain.
- Well-known resolver registry (Cloudflare, Google, Quad9, OpenDNS, AdGuard, Control D).
- System resolver mode via `/etc/resolv.conf`.
- TXT record parsing for SPF, DMARC, DKIM, and domain verification tokens.
- `pairedItem` on all output items.
- Linter compliance in strict mode.
- Provenance-attested npm publishing via GitHub Actions.

**Out of scope for v1.0:**

- DNS-over-HTTPS (DoH) and DNS-over-TLS (DoT). HTTP-based — use the HTTP Request node.
- DNSSEC cryptographic validation. Records are returned as raw data.
- Zone transfers (AXFR/IXFR). Require TCP and long-lived connections.
- TCP fallback for truncated responses. TC flag is reported but not acted on.
- EDNS0 OPT records. Limits responses to 512 bytes.
- Acting as a DNS server. Client-only.
- Dynamic `loadOptions` dropdowns. No applicable use case (domain names are free-text, not enumerable).

**Planned for future versions:**

- **v1.1:** TCP fallback when TC flag is set. EDNS0 support for larger responses.
- **v1.2:** DNS-over-HTTPS support for encrypted resolution via Cloudflare and Google DoH endpoints.
- **v1.3:** DNSBL helper mode — accept an IP, auto-reverse, query configurable blocklist zones.
- **v2.0:** Batch mode with socket pooling. mDNS for `.local` multicast discovery. Structured diff output for the Watch trigger.

---

## Publishing and Verification

The package will be published to npm under the name `n8n-nodes-dns` with the `n8n-community-node-package` keyword for discoverability. The `package.json` `keywords` array will include `n8n-community-node-package`, `n8n`, `dns`, `domain`, `nameserver`, `propagation`, `dnsbl`, `spf`, `dmarc`, `dkim`, `email-security`, `monitoring`, and `network`. The `n8n` object in `package.json` registers the node and credential paths under `dist/`:

```json
{
  "n8n": {
    "n8nNodesApiVersion": 1,
    "nodes": [
      "dist/nodes/DnsLookup/DnsLookup.node.js",
      "dist/nodes/DnsWatch/DnsWatch.node.js"
    ],
    "credentials": [
      "dist/credentials/DnsServerApi.credentials.js"
    ]
  }
}
```

Publication uses the GitHub Actions workflow from the n8n starter template, producing an npm provenance attestation. The npm package author and the GitHub repository owner will match — a verification requirement.

The zero-dependency design, MIT license, `@n8n/node-cli` scaffolding, strict-mode linter compliance, and provenance attestation align with all current n8n community node verification criteria.

---

## Documentation References

Primary n8n documentation for implementation:

- Building community nodes: `https://docs.n8n.io/integrations/community-nodes/build-community-nodes/`
- Verification guidelines: `https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/`
- Code standards: `https://docs.n8n.io/integrations/creating-nodes/build/reference/code-standards/`
- UX guidelines: `https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/`
- Error handling: `https://docs.n8n.io/integrations/creating-nodes/build/reference/error-handling/`
- Credentials file reference: `https://docs.n8n.io/integrations/creating-nodes/build/reference/credentials-files/`
- Node base files: `https://docs.n8n.io/integrations/creating-nodes/build/reference/node-base-files/`
- Submit community nodes: `https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/`
- n8n-node CLI tool: `https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/`

Protocol references:

- RFC 1035: Domain Names — Implementation and Specification
- RFC 6895: DNS IANA Considerations (record type registry)
- RFC 7208: Sender Policy Framework (SPF)
- RFC 7489: Domain-based Message Authentication, Reporting, and Conformance (DMARC)
- RFC 6376: DomainKeys Identified Mail (DKIM)
- RFC 8659: DNS Certification Authority Authorization (CAA)
