# n8n-nodes-dns

An [n8n](https://n8n.io/) community node for raw DNS queries using the [DNS wire protocol](https://datatracker.ietf.org/doc/html/rfc1035) (RFC 1035). Query any record type against well-known public resolvers, custom servers, or auto-discovered authoritative nameservers — with built-in propagation checking and TXT record parsing for SPF, DMARC, and DKIM.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) | [Operations](#operations) | [Credentials](#credentials) | [Compatibility](#compatibility) | [Resources](#resources)

## Why this node?

There is no built-in n8n node for raw DNS queries. The Node.js `dns` module (accessible via the Code node) delegates to the system resolver and hides critical information — you can't choose which nameserver to query, don't get TTL values, can't see authority sections, and can't query multiple resolvers in parallel.

Common workarounds have significant drawbacks:

- **Execute Command + `dig`** — fragile text parsing, unavailable on n8n Cloud
- **HTTP Request + Google DoH** — requires 7+ nodes for what should be one operation, locked to a single resolver, no propagation checking
- **Third-party APIs** — paid services with no control over which resolver is queried

This node replaces all of that with a single node that speaks the DNS wire protocol directly, returning structured JSON with full control over which servers to query.

## Features

- **13 record types** — A, AAAA, MX, TXT, SRV, PTR, CAA, SOA, NS, CNAME, NAPTR, DNSKEY, TLSA
- **Four resolver modes** — well-known public resolvers, custom servers, authoritative (auto-discover via NS delegation), system (`/etc/resolv.conf`)
- **9 well-known resolvers** — Cloudflare, Google, Quad9, Quad9 Unfiltered, OpenDNS, Cloudflare Malware, Cloudflare Family, AdGuard, Control D
- **Multi-server parallel dispatch** — query multiple resolvers concurrently using `Promise.allSettled`, one slow server never blocks others
- **Propagation monitoring** — compare answers across resolvers with `consistent` and `propagatedToAll` flags, designed for downstream IF nodes
- **TXT record parsing** — automatic structured parsing of SPF, DMARC, DKIM, and verification tokens (Google, Microsoft, Facebook, Stripe, Atlassian, Apple, GitHub Pages, Postmark)
- **DNS Watch trigger** — poll for DNS record changes with configurable fire conditions: any change, record appears, record disappears, value matches
- **Authoritative discovery** — auto-discover authoritative nameservers by walking the NS delegation chain, with glue record optimization
- **DNS response codes as data** — NXDOMAIN, SERVFAIL, REFUSED are returned as structured output (not exceptions), enabling domain-existence monitoring
- **Configurable timeout and retry** — per-query timeout (default 5000ms) and retry count (default 1)
- **Truncated response handling** — responses with the TC flag include a `truncated: true` field
- **Item linking** — correct `pairedItem` on every output for n8n expression support in downstream nodes
- **Pure wire protocol** — zero external runtime dependencies, implements RFC 1035 from scratch using only Node.js built-ins (`dgram`, `crypto`, `Buffer`)
- **AI agent integration** — `usableAsTool` enabled on both nodes for use in n8n AI workflows
- **Continue on fail** — standard n8n error handling support

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

### DNS Lookup

Perform raw DNS queries using the DNS wire protocol.

| Parameter | Description |
|-----------|-------------|
| **Domain** | The domain name to query (expression-enabled for per-item resolution) |
| **Record Type** | A, AAAA, MX, TXT, SRV, PTR, CAA, SOA, NS, CNAME, NAPTR, DNSKEY, TLSA |
| **Resolver Mode** | Well-Known, Custom, Authoritative (auto-discover), System |
| **Resolvers** | Select one or more: Cloudflare, Cloudflare Malware, Cloudflare Family, Google, Quad9, Quad9 Unfiltered, OpenDNS, AdGuard, Control D |
| **Custom Servers** | Repeatable IP/port pairs (visible when Resolver Mode = Custom) |
| **Options** | Output consistency check, timeout, retry count, recursion desired |

### DNS Watch

Watch for DNS record changes by polling. Supports all the same parameters as DNS Lookup, plus:

| Parameter | Description |
|-----------|-------------|
| **Fire On** | Any Change, Record Appears, Record Disappears, Value Matches |
| **Expected Value** | Value to match when using "Value Matches" mode (supports JSON for complex records like MX/SRV) |

## Credentials

### DNS Server (optional)

Store a reusable DNS server configuration. This credential is optional — if not configured, the node uses the selected resolver mode. DNS has no authentication mechanism, so no token or password is needed.

| Field | Required | Description |
|-------|----------|-------------|
| Server | Yes | IP address or hostname of the DNS server |
| Port | No | UDP port of the DNS server (default: 53) |

## Output Format

### Single Server

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

### Multiple Servers

When querying multiple servers, the output is one combined item per input with consistency flags:

```json
{
  "domain": "example.com",
  "type": "A",
  "results": [
    { "server": "1.1.1.1", "serverName": "Cloudflare", "answers": [...], "responseTimeMs": 12 },
    { "server": "8.8.8.8", "serverName": "Google", "answers": [...], "responseTimeMs": 18 }
  ],
  "consistent": true,
  "propagatedToAll": true,
  "serverCount": 2,
  "uniqueAnswers": 1
}
```

### Record Type Values

| Type | Value Format |
|------|-------------|
| A / AAAA | Plain IP string |
| MX | `{ "priority": 10, "exchange": "mail.example.com" }` |
| TXT | `{ "raw": "v=spf1 ...", "parsed": { ... } }` — parsed when SPF, DMARC, DKIM, or verification token detected |
| SRV | `{ "priority": 10, "weight": 60, "port": 5060, "target": "sip.example.com" }` |
| SOA | `{ "mname": "...", "rname": "...", "serial": 2024010101, ... }` |
| NS / CNAME / PTR | Plain hostname string |
| CAA | `{ "flags": 0, "tag": "issue", "value": "letsencrypt.org" }` |
| NAPTR | `{ "order": 10, "preference": 100, "flags": "s", "service": "SIP+D2U", ... }` |
| DNSKEY | `{ "flags": 256, "protocol": 3, "algorithm": 13, "publicKey": "base64..." }` |
| TLSA | `{ "usage": 3, "selector": 1, "matchingType": 1, "certificateData": "hex..." }` |

## Compatibility

- **Minimum n8n version:** 1.71.0 (`n8nNodesApiVersion` 1)

## Development

### Prerequisites

- Node.js 22+
- [just](https://github.com/casey/just) command runner

### Commands

| Recipe | Description |
|--------|-------------|
| `just build` | Compile TypeScript to `dist/` |
| `just dev` | Watch mode — starts local n8n with the node loaded |
| `just lint` | Run the n8n node linter |
| `just lint-fix` | Lint and auto-fix |
| `just format` | Run Prettier |
| `just format-check` | Check formatting without writing |
| `just test` | Run unit + integration tests |
| `just test-unit` | Run unit tests only |
| `just test-int` | Run integration tests (uses in-process DNS server) |
| `just test-e2e` | Run e2e tests (uses in-process DNS server) |
| `just test-all` | Run all test suites |
| `just test-coverage` | Unit + integration with coverage enforcement |
| `just check` | Full pre-publish check: lint + format + tests + build + verify |
| `just verify` | Run the n8n community package scanner |

### Test Suites

- **Unit tests** (`test/unit/`) — transport layer, record parsers, name compression, TXT parsers
- **Integration tests** (`test/integration/`) — DNS client and resolver queries with in-process DNS server
- **E2E tests** (`test/e2e/`) — full node execution for Lookup and Watch nodes

## Design & Planning

See [DESIGN.md](DESIGN.md) for architecture docs, epics, and stories.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [DNS wire protocol — RFC 1035](https://datatracker.ietf.org/doc/html/rfc1035)

## Version History

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
