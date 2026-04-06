import { NodeOperationError } from 'n8n-workflow';
import type { DnsServerResult } from '../../src/transport';
import {
	isWarnableResponseCode,
	isFatalResponseCode,
	buildWarningMessage,
	assertNotFormerr,
	collectResponseWarnings,
	extractDnsQueryParams,
} from '../../src/nodes/shared/dns-node-helpers';
import type { DnsParameterReader } from '../../src/nodes/shared/dns-node-helpers';

function makeNode() {
	return {
		id: 'test-id',
		name: 'TestNode',
		type: 'test',
		typeVersion: 1,
		position: [0, 0] as [number, number],
		parameters: {},
	};
}

function makeServerResult(overrides: Partial<DnsServerResult> = {}): DnsServerResult {
	return {
		server: { address: '1.1.1.1', port: 53 },
		response: null,
		responseCode: 'NOERROR',
		truncated: false,
		responseTimeMilliseconds: 12,
		...overrides,
	};
}

describe('isWarnableResponseCode', () => {
	it.each(['SERVFAIL', 'REFUSED', 'NOTIMP'])('returns true for %s', (code) => {
		expect(isWarnableResponseCode(code)).toBe(true);
	});

	it.each(['NOERROR', 'NXDOMAIN', 'FORMERR', 'TIMEOUT', 'UNKNOWN'])(
		'returns false for %s',
		(code) => {
			expect(isWarnableResponseCode(code)).toBe(false);
		},
	);
});

describe('isFatalResponseCode', () => {
	it('returns true for FORMERR', () => {
		expect(isFatalResponseCode('FORMERR')).toBe(true);
	});

	it.each(['NOERROR', 'NXDOMAIN', 'SERVFAIL', 'REFUSED', 'TIMEOUT'])(
		'returns false for %s',
		(code) => {
			expect(isFatalResponseCode(code)).toBe(false);
		},
	);
});

describe('buildWarningMessage', () => {
	it('produces a descriptive warning string', () => {
		const message = buildWarningMessage('example.com', '1.1.1.1', 'SERVFAIL');

		expect(message).toBe('DNS server 1.1.1.1 returned SERVFAIL for example.com');
	});
});

describe('assertNotFormerr', () => {
	it('throws NodeOperationError for FORMERR', () => {
		const result = makeServerResult({ responseCode: 'FORMERR' });
		const node = makeNode();

		expect(() => assertNotFormerr(result, 'example.com', node)).toThrow(NodeOperationError);
	});

	it('includes itemIndex in the error when provided', () => {
		const result = makeServerResult({ responseCode: 'FORMERR' });
		const node = makeNode();

		try {
			assertNotFormerr(result, 'example.com', node, 3);
			fail('Expected error to be thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(NodeOperationError);
			expect((error as NodeOperationError).context).toMatchObject({ itemIndex: 3 });
		}
	});

	it.each(['NOERROR', 'NXDOMAIN', 'SERVFAIL', 'REFUSED', 'TIMEOUT'])(
		'does not throw for %s',
		(code) => {
			const result = makeServerResult({ responseCode: code });
			const node = makeNode();

			expect(() => assertNotFormerr(result, 'example.com', node)).not.toThrow();
		},
	);
});

describe('collectResponseWarnings', () => {
	it('returns warnings for warnable response codes', () => {
		const results = [
			makeServerResult({ server: { address: '1.1.1.1', port: 53 }, responseCode: 'SERVFAIL' }),
			makeServerResult({ server: { address: '8.8.8.8', port: 53 }, responseCode: 'REFUSED' }),
		];

		const warnings = collectResponseWarnings(results, 'example.com');

		expect(warnings).toEqual([
			'DNS server 1.1.1.1 returned SERVFAIL for example.com',
			'DNS server 8.8.8.8 returned REFUSED for example.com',
		]);
	});

	it('returns empty array when no warnable codes', () => {
		const results = [
			makeServerResult({ responseCode: 'NOERROR' }),
			makeServerResult({ responseCode: 'NXDOMAIN' }),
		];

		const warnings = collectResponseWarnings(results, 'example.com');

		expect(warnings).toEqual([]);
	});

	it('filters out non-warnable codes in mixed results', () => {
		const results = [
			makeServerResult({ server: { address: '1.1.1.1', port: 53 }, responseCode: 'NOERROR' }),
			makeServerResult({ server: { address: '8.8.8.8', port: 53 }, responseCode: 'SERVFAIL' }),
			makeServerResult({ server: { address: '9.9.9.9', port: 53 }, responseCode: 'NXDOMAIN' }),
		];

		const warnings = collectResponseWarnings(results, 'example.com');

		expect(warnings).toEqual(['DNS server 8.8.8.8 returned SERVFAIL for example.com']);
	});

	it('returns empty array for empty results', () => {
		expect(collectResponseWarnings([], 'example.com')).toEqual([]);
	});
});

describe('extractDnsQueryParams', () => {
	function makeReader(params: Record<string, unknown>): DnsParameterReader {
		return {
			getParam: (name: string, fallback?: unknown) => (name in params ? params[name] : fallback),
		};
	}

	it('extracts params and resolves well-known servers', async () => {
		const reader = makeReader({
			domain: 'example.com',
			recordType: 'A',
			resolverMode: 'wellKnown',
			resolvers: ['Cloudflare'],
			options: {},
		});

		const result = await extractDnsQueryParams(reader);

		expect(result.domain).toBe('example.com');
		expect(result.recordType).toBe('A');
		expect(result.resolverMode).toBe('wellKnown');
		expect(result.servers.length).toBeGreaterThan(0);
		expect(result.servers[0]!.address).toBe('1.1.1.1');
	});

	it('passes timeout and retryCount through to clientOptions', async () => {
		const reader = makeReader({
			domain: 'example.com',
			recordType: 'AAAA',
			resolverMode: 'wellKnown',
			resolvers: ['Cloudflare'],
			options: { timeout: 5000, retryCount: 3 },
		});

		const result = await extractDnsQueryParams(reader);

		expect(result.clientOptions).toEqual({
			timeoutMilliseconds: 5000,
			retryCount: 3,
		});
	});

	it('resolves custom servers from fixedCollection shape', async () => {
		const reader = makeReader({
			domain: 'example.com',
			recordType: 'MX',
			resolverMode: 'custom',
			customServers: {
				serverValues: [{ address: '10.0.0.1', port: 5353 }],
			},
			options: {},
		});

		const result = await extractDnsQueryParams(reader);

		expect(result.servers).toEqual([{ address: '10.0.0.1', port: 5353 }]);
	});

	it('returns empty servers when wellKnown names list is empty', async () => {
		const reader = makeReader({
			domain: 'example.com',
			recordType: 'A',
			resolverMode: 'wellKnown',
			resolvers: [],
			options: {},
		});

		const result = await extractDnsQueryParams(reader);

		expect(result.servers).toEqual([]);
	});

	it('preserves raw options including outputConsistencyCheck', async () => {
		const reader = makeReader({
			domain: 'example.com',
			recordType: 'A',
			resolverMode: 'wellKnown',
			resolvers: ['Cloudflare'],
			options: { outputConsistencyCheck: false },
		});

		const result = await extractDnsQueryParams(reader);

		expect(result.options.outputConsistencyCheck).toBe(false);
	});
});
