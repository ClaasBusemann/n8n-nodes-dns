import { NodeOperationError } from 'n8n-workflow';
import type { DnsServerResult } from '../../src/transport';
import {
	isWarnableResponseCode,
	isFatalResponseCode,
	buildWarningMessage,
	assertNotFormerr,
	collectResponseWarnings,
} from '../../src/nodes/shared/dns-node-helpers';

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
