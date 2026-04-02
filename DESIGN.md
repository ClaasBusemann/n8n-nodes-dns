# Design & Planning

All design docs, epics, and stories live in the [`kontext/`](kontext/) directory.

## Design Docs

- [DNS Node Design Document](kontext/docs/n8n-dns-node.md)

## Epics & Stories

### [Project Setup & Tooling](kontext/epics/scaffolding.md)

- [KNX-00001](kontext/stories/KNX-00001.md) — Scaffold project and configure tooling

### [DNS Wire Protocol & Transport](kontext/epics/transport.md)

- [KNX-00002](kontext/stories/KNX-00002.md) — DNS name compression codec
- [KNX-00003](kontext/stories/KNX-00003.md) — DNS wire format encoder/decoder
- [KNX-00004](kontext/stories/KNX-00004.md) — UDP DNS client with timeout, retry, and parallel dispatch
- [KNX-00005](kontext/stories/KNX-00005.md) — Well-known resolver registry and system resolver
- [KNX-00006](kontext/stories/KNX-00006.md) — Authoritative nameserver discovery

### [Record & TXT Parsing](kontext/epics/parsing.md)

- [KNX-00007](kontext/stories/KNX-00007.md) — RDATA record parsers for all supported types
- [KNX-00008](kontext/stories/KNX-00008.md) — SPF and DMARC TXT parsers
- [KNX-00009](kontext/stories/KNX-00009.md) — DKIM and verification token TXT parsers

### [n8n Node Implementation](kontext/epics/nodes.md)

- [KNX-00010](kontext/stories/KNX-00010.md) — DnsServerApi credentials definition
- [KNX-00011](kontext/stories/KNX-00011.md) — DNS Lookup action node
- [KNX-00012](kontext/stories/KNX-00012.md) — Multi-server output format and consistency flags
- [KNX-00013](kontext/stories/KNX-00013.md) — DNS Watch polling trigger node
- [KNX-00014](kontext/stories/KNX-00014.md) — Codex metadata files for both nodes
- [KNX-00015](kontext/stories/KNX-00015.md) — Item linking and error handling

### [Integration Testing & Quality Assurance](kontext/epics/testing-qa.md)

- [KNX-00016](kontext/stories/KNX-00016.md) — Integration tests for DNS client and resolver queries
- [KNX-00017](kontext/stories/KNX-00017.md) — E2E tests for Lookup and Watch nodes

### [Publishing & Verification](kontext/epics/publishing.md)

- [KNX-00018](kontext/stories/KNX-00018.md) — GitHub Actions publish workflow with provenance
- [KNX-00019](kontext/stories/KNX-00019.md) — Linter compliance and package.json for npm verification
