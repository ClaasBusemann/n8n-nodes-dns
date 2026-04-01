import type { DnsServerResult, DnsResponse } from '../../src/transport';
import { DNS_DEFAULT_PORT } from '../../src/transport';
import {
	computeConsistencyFlags,
	buildMultiServerOutput,
} from '../../src/nodes/DnsLookup/DnsLookup.node';
import type { ServerResultEntry } from '../../src/nodes/shared/dns-node-helpers';
import {
	serializeAnswerValues,
	formatServerResult,
	buildSingleServerOutput,
	buildClientOptions,
	extractCustomServers,
} from '../../src/nodes/shared/dns-node-helpers';
import { makeFormattedRecord } from '../helpers/mock-dns-records';

function makeServerEntry(overrides: Partial<ServerResultEntry> = {}): ServerResultEntry {
	return {
		server: '1.1.1.1',
		serverName: 'Cloudflare',
		authoritative: false,
		responseCode: 'NOERROR',
		responseTimeMs: 12,
		answers: [makeFormattedRecord()],
		authority: [],
		additional: [],
		...overrides,
	};
}

function makeHeaderFlags(overrides: Partial<DnsResponse['header']['flags']> = {}) {
	return {
		queryResponse: true,
		opcode: 0,
		authoritative: false,
		truncated: false,
		recursionDesired: true,
		recursionAvailable: true,
		responseCode: 0,
		...overrides,
	};
}

function makeResponse(overrides: Partial<DnsResponse> = {}): DnsResponse {
	const { header: headerOverrides, ...rest } = overrides;
	return {
		header: {
			transactionId: 0x1234,
			questionCount: 1,
			answerCount: 0,
			authorityCount: 0,
			additionalCount: 0,
			...headerOverrides,
			flags: makeHeaderFlags(headerOverrides?.flags),
		},
		questions: [],
		answers: [],
		authorities: [],
		additionals: [],
		rawPacket: Buffer.alloc(0),
		...rest,
	};
}

function makeServerResult(overrides: Partial<DnsServerResult> = {}): DnsServerResult {
	return {
		server: { address: '1.1.1.1', port: 53 },
		response: makeResponse(),
		responseCode: 'NOERROR',
		truncated: false,
		responseTimeMilliseconds: 12,
		...overrides,
	};
}

describe('computeConsistencyFlags', () => {
	it('returns consistent when all entries have identical answers', () => {
		const entries = [
			makeServerEntry({ server: '1.1.1.1' }),
			makeServerEntry({ server: '8.8.8.8' }),
			makeServerEntry({ server: '9.9.9.9' }),
		];

		const flags = computeConsistencyFlags(entries);

		expect(flags.consistent).toBe(true);
		expect(flags.propagatedToAll).toBe(true);
		expect(flags.uniqueAnswers).toBe(1);
	});

	it('returns inconsistent when entries have different answers', () => {
		const entries = [
			makeServerEntry({ answers: [makeFormattedRecord({ value: '1.2.3.4' })] }),
			makeServerEntry({ answers: [makeFormattedRecord({ value: '5.6.7.8' })] }),
		];

		const flags = computeConsistencyFlags(entries);

		expect(flags.consistent).toBe(false);
		expect(flags.uniqueAnswers).toBe(2);
	});

	it('detects propagation failure when non-auth answers differ from authoritative', () => {
		const authEntry = makeServerEntry({
			authoritative: true,
			answers: [makeFormattedRecord({ value: '10.0.0.1' })],
		});
		const staleEntry = makeServerEntry({
			authoritative: false,
			answers: [makeFormattedRecord({ value: '10.0.0.99' })],
		});
		const freshEntry = makeServerEntry({
			authoritative: false,
			answers: [makeFormattedRecord({ value: '10.0.0.1' })],
		});

		const flags = computeConsistencyFlags([authEntry, staleEntry, freshEntry]);

		expect(flags.consistent).toBe(false);
		expect(flags.propagatedToAll).toBe(false);
		expect(flags.uniqueAnswers).toBe(2);
	});

	it('reports propagatedToAll when all non-auth match authoritative', () => {
		const authEntry = makeServerEntry({
			authoritative: true,
			answers: [makeFormattedRecord({ value: '10.0.0.1' })],
		});
		const nonAuthEntry = makeServerEntry({
			authoritative: false,
			answers: [makeFormattedRecord({ value: '10.0.0.1' })],
		});

		const flags = computeConsistencyFlags([authEntry, nonAuthEntry]);

		expect(flags.consistent).toBe(true);
		expect(flags.propagatedToAll).toBe(true);
	});

	it('handles a single entry as consistent', () => {
		const flags = computeConsistencyFlags([makeServerEntry()]);

		expect(flags.consistent).toBe(true);
		expect(flags.propagatedToAll).toBe(true);
		expect(flags.uniqueAnswers).toBe(1);
	});

	it('handles empty entries as consistent', () => {
		const flags = computeConsistencyFlags([]);

		expect(flags.consistent).toBe(true);
		expect(flags.propagatedToAll).toBe(true);
		expect(flags.uniqueAnswers).toBe(0);
	});

	it('ignores TTL differences when comparing answers', () => {
		const entries = [
			makeServerEntry({
				answers: [makeFormattedRecord({ ttl: 300 })],
			}),
			makeServerEntry({
				answers: [makeFormattedRecord({ ttl: 60 })],
			}),
		];

		const flags = computeConsistencyFlags(entries);

		expect(flags.consistent).toBe(true);
		expect(flags.uniqueAnswers).toBe(1);
	});

	it('ignores answer order when comparing', () => {
		const recordA = makeFormattedRecord({ value: '1.1.1.1' });
		const recordB = makeFormattedRecord({ value: '2.2.2.2' });

		const entries = [
			makeServerEntry({ answers: [recordA, recordB] }),
			makeServerEntry({ answers: [recordB, recordA] }),
		];

		const flags = computeConsistencyFlags(entries);

		expect(flags.consistent).toBe(true);
		expect(flags.uniqueAnswers).toBe(1);
	});
});

describe('serializeAnswerValues', () => {
	it('produces the same output regardless of answer order', () => {
		const recordA = makeFormattedRecord({ name: 'a.com', value: '1.1.1.1' });
		const recordB = makeFormattedRecord({ name: 'b.com', value: '2.2.2.2' });

		const forward = serializeAnswerValues([recordA, recordB]);
		const reversed = serializeAnswerValues([recordB, recordA]);

		expect(forward).toBe(reversed);
	});

	it('produces different output for different answers', () => {
		const answersA = [makeFormattedRecord({ value: '1.1.1.1' })];
		const answersB = [makeFormattedRecord({ value: '2.2.2.2' })];

		expect(serializeAnswerValues(answersA)).not.toBe(serializeAnswerValues(answersB));
	});

	it('produces consistent output for empty answers', () => {
		expect(serializeAnswerValues([])).toBe(serializeAnswerValues([]));
	});
});

describe('formatServerResult', () => {
	it('maps response fields to the output shape', () => {
		const result = makeServerResult({
			server: { address: '8.8.8.8', port: 53 },
			response: makeResponse({
				header: {
					transactionId: 1,
					flags: makeHeaderFlags({ authoritative: true }),
					questionCount: 1,
					answerCount: 0,
					authorityCount: 0,
					additionalCount: 0,
				},
			}),
			responseCode: 'NOERROR',
			responseTimeMilliseconds: 42,
		});

		const entry = formatServerResult(result);

		expect(entry.server).toBe('8.8.8.8');
		expect(entry.authoritative).toBe(true);
		expect(entry.responseCode).toBe('NOERROR');
		expect(entry.responseTimeMs).toBe(42);
		expect(entry.answers).toEqual([]);
		expect(entry.authority).toEqual([]);
		expect(entry.additional).toEqual([]);
	});

	it('handles null response gracefully', () => {
		const result = makeServerResult({
			response: null,
			responseCode: 'TIMEOUT',
		});

		const entry = formatServerResult(result);

		expect(entry.authoritative).toBe(false);
		expect(entry.answers).toEqual([]);
		expect(entry.authority).toEqual([]);
		expect(entry.additional).toEqual([]);
	});

	it('includes truncated flag only when true', () => {
		const truncated = formatServerResult(makeServerResult({ truncated: true }));
		const normal = formatServerResult(makeServerResult({ truncated: false }));

		expect(truncated.truncated).toBe(true);
		expect(normal.truncated).toBeUndefined();
	});

	it('resolves well-known server names', () => {
		const result = makeServerResult({
			server: { address: '1.1.1.1', port: 53 },
		});

		const entry = formatServerResult(result);

		expect(entry.serverName).toBe('Cloudflare');
	});

	it('falls back to IP address for unknown servers', () => {
		const result = makeServerResult({
			server: { address: '192.168.1.1', port: 53 },
		});

		const entry = formatServerResult(result);

		expect(entry.serverName).toBe('192.168.1.1');
	});
});

describe('buildSingleServerOutput', () => {
	it('includes domain and type at the top level', () => {
		const result = makeServerResult();
		const output = buildSingleServerOutput('example.com', 'A', result);

		expect(output.domain).toBe('example.com');
		expect(output.type).toBe('A');
		expect(output.server).toBe('1.1.1.1');
	});
});

describe('buildMultiServerOutput', () => {
	it('includes consistency flags when check is enabled', () => {
		const results = [
			makeServerResult({ server: { address: '1.1.1.1', port: 53 } }),
			makeServerResult({ server: { address: '8.8.8.8', port: 53 } }),
		];

		const output = buildMultiServerOutput('example.com', 'A', results, true);

		expect(output.domain).toBe('example.com');
		expect(output.type).toBe('A');
		expect(output.results).toHaveLength(2);
		expect(output).toHaveProperty('consistent');
		expect(output).toHaveProperty('propagatedToAll');
		expect(output).toHaveProperty('serverCount', 2);
		expect(output).toHaveProperty('uniqueAnswers');
	});

	it('omits consistency flags when check is disabled', () => {
		const results = [
			makeServerResult({ server: { address: '1.1.1.1', port: 53 } }),
			makeServerResult({ server: { address: '8.8.8.8', port: 53 } }),
		];

		const output = buildMultiServerOutput('example.com', 'A', results, false);

		expect(output.domain).toBe('example.com');
		expect(output.results).toHaveLength(2);
		expect(output).not.toHaveProperty('consistent');
		expect(output).not.toHaveProperty('propagatedToAll');
		expect(output).not.toHaveProperty('serverCount');
		expect(output).not.toHaveProperty('uniqueAnswers');
	});
});

describe('buildClientOptions', () => {
	it('maps all provided options', () => {
		const result = buildClientOptions({
			timeout: 3000,
			retryCount: 2,
			recursionDesired: false,
		});

		expect(result).toEqual({
			timeoutMilliseconds: 3000,
			retryCount: 2,
			recursionDesired: false,
		});
	});

	it('returns empty object when no options are defined', () => {
		const result = buildClientOptions({});

		expect(result).toEqual({});
	});

	it('includes only defined options', () => {
		const result = buildClientOptions({ timeout: 1000 });

		expect(result).toEqual({ timeoutMilliseconds: 1000 });
		expect(result).not.toHaveProperty('retryCount');
		expect(result).not.toHaveProperty('recursionDesired');
	});
});

describe('extractCustomServers', () => {
	it('extracts servers from fixedCollection parameter shape', () => {
		const paramValue = {
			serverValues: [
				{ address: '10.0.0.1', port: 5353 },
				{ address: '10.0.0.2', port: 8053 },
			],
		};

		const servers = extractCustomServers(paramValue);

		expect(servers).toEqual([
			{ address: '10.0.0.1', port: 5353 },
			{ address: '10.0.0.2', port: 8053 },
		]);
	});

	it('defaults port to DNS_DEFAULT_PORT when not specified', () => {
		const paramValue = {
			serverValues: [{ address: '10.0.0.1', port: undefined as unknown as number }],
		};

		const servers = extractCustomServers(paramValue);

		expect(servers).toEqual([{ address: '10.0.0.1', port: DNS_DEFAULT_PORT }]);
	});

	it('returns empty array when serverValues is missing', () => {
		const servers = extractCustomServers({});

		expect(servers).toEqual([]);
	});

	it('returns empty array for empty serverValues', () => {
		const servers = extractCustomServers({ serverValues: [] });

		expect(servers).toEqual([]);
	});
});
