import { DnsLookup } from '../../src/nodes/DnsLookup/DnsLookup.node';
import { createMockExecuteContext } from '../helpers/mock-execute-context';
import { describeIntegration } from '../helpers/integration-gate';
import { getTestServer } from '../helpers/test-dns-server';
import type { TxtRecordValue } from '../../src/utils/record-parsers';

const NETWORK_TEST_TIMEOUT = 15000;
const MULTI_SERVER_TEST_TIMEOUT = 30000;

const SINGLE_SERVER_SCHEMA_KEYS = [
	'domain',
	'type',
	'server',
	'serverName',
	'authoritative',
	'responseCode',
	'responseTimeMs',
	'answers',
	'authority',
	'additional',
];

const ANSWER_SCHEMA_KEYS = ['name', 'type', 'ttl', 'value'];

const TEST_SERVER = getTestServer();

function createSingleServerContext(overrides: Record<string, unknown> = {}) {
	return createMockExecuteContext({
		nodeParameters: {
			domain: 'example.com',
			recordType: 'A',
			resolverMode: 'custom',
			customServers: { serverValues: [TEST_SERVER] },
			options: {},
			...overrides,
		},
	});
}

describeIntegration('DnsLookup E2E', () => {
	const node = new DnsLookup();

	it(
		'returns output matching the single-server schema for an A record',
		async () => {
			const context = createSingleServerContext();
			const result = await node.execute.call(context);

			expect(result).toHaveLength(1);
			expect(result[0]!.length).toBeGreaterThanOrEqual(1);

			const output = result[0]![0]!.json;
			for (const key of SINGLE_SERVER_SCHEMA_KEYS) {
				expect(output).toHaveProperty(key);
			}

			expect(output.domain).toBe('example.com');
			expect(output.type).toBe('A');
			expect(output.responseCode).toBe('NOERROR');
			expect(typeof output.responseTimeMs).toBe('number');
			expect(typeof output.server).toBe('string');
			expect(typeof output.serverName).toBe('string');
			expect(typeof output.authoritative).toBe('boolean');

			const answers = output.answers as Array<Record<string, unknown>>;
			expect(answers.length).toBeGreaterThan(0);
			for (const answer of answers) {
				for (const key of ANSWER_SCHEMA_KEYS) {
					expect(answer).toHaveProperty(key);
				}
			}

			expect(output.authority).toEqual(expect.any(Array));
			expect(output.additional).toEqual(expect.any(Array));
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'resolves expressions by using the resolved parameter value',
		async () => {
			const context = createMockExecuteContext({
				nodeParameters: {
					domain: 'example.com',
					recordType: 'A',
					resolverMode: 'custom',
					customServers: { serverValues: [TEST_SERVER] },
					options: {},
				},
				inputItems: [{ json: { domain: 'example.com' } }],
			});

			const result = await node.execute.call(context);

			expect(result).toHaveLength(1);
			expect(result[0]!.length).toBeGreaterThanOrEqual(1);

			const output = result[0]![0]!.json;
			expect(output.domain).toBe('example.com');

			const answers = output.answers as unknown[];
			expect(answers.length).toBeGreaterThan(0);

			expect(result[0]![0]!.pairedItem).toEqual({ item: 0 });
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'returns multi-server output with consistency flags',
		async () => {
			const context = createMockExecuteContext({
				nodeParameters: {
					domain: 'example.com',
					recordType: 'A',
					resolverMode: 'custom',
					customServers: {
						serverValues: [TEST_SERVER, TEST_SERVER, TEST_SERVER],
					},
					options: {},
				},
			});

			const result = await node.execute.call(context);

			expect(result).toHaveLength(1);
			const output = result[0]![0]!.json;

			expect(output).toHaveProperty('results');
			expect(output).toHaveProperty('consistent');
			expect(output).toHaveProperty('propagatedToAll');
			expect(output).toHaveProperty('serverCount');
			expect(output).toHaveProperty('uniqueAnswers');

			const results = output.results as Array<Record<string, unknown>>;
			expect(results.length).toBe(3);

			for (const serverResult of results) {
				expect(serverResult).toHaveProperty('server');
				expect(serverResult).toHaveProperty('serverName');
				expect(serverResult).toHaveProperty('answers');
			}

			expect(typeof output.consistent).toBe('boolean');
			expect(typeof output.propagatedToAll).toBe('boolean');
			expect(typeof output.serverCount).toBe('number');
			expect(typeof output.uniqueAnswers).toBe('number');
		},
		MULTI_SERVER_TEST_TIMEOUT,
	);

	it(
		'returns error in output without throwing when continueOnFail is enabled',
		async () => {
			const context = createMockExecuteContext({
				nodeParameters: {
					domain: 'example.com',
					recordType: 'A',
					resolverMode: 'custom',
					customServers: { serverValues: [] },
					options: {},
				},
				continueOnFail: true,
			});

			const result = await node.execute.call(context);

			expect(result).toHaveLength(1);
			expect(result[0]!.length).toBeGreaterThanOrEqual(1);

			const output = result[0]![0]!.json;
			expect(output).toHaveProperty('error');
			expect(typeof output.error).toBe('string');
			expect((output.error as string).length).toBeGreaterThan(0);
		},
		NETWORK_TEST_TIMEOUT,
	);

	const recordTypeTestCases: Array<{
		recordType: string;
		domain: string;
		expectAnswers: boolean;
	}> = [
		{ recordType: 'A', domain: 'example.com', expectAnswers: true },
		{ recordType: 'AAAA', domain: 'example.com', expectAnswers: true },
		{ recordType: 'MX', domain: 'example.com', expectAnswers: true },
		{ recordType: 'TXT', domain: 'example.com', expectAnswers: true },
		{ recordType: 'NS', domain: 'example.com', expectAnswers: true },
		{ recordType: 'SOA', domain: 'example.com', expectAnswers: true },
		{ recordType: 'CNAME', domain: 'www.github.com', expectAnswers: true },
		{ recordType: 'CAA', domain: 'example.com', expectAnswers: true },
		{ recordType: 'SRV', domain: '_sip._tcp.example.com', expectAnswers: true },
		{ recordType: 'PTR', domain: '34.216.184.93.in-addr.arpa', expectAnswers: true },
	];

	it.each(recordTypeTestCases)(
		'queries $recordType record for $domain without error',
		async ({ recordType, domain, expectAnswers }) => {
			const context = createSingleServerContext({ domain, recordType });
			const result = await node.execute.call(context);

			expect(result).toHaveLength(1);
			expect(result[0]!.length).toBeGreaterThanOrEqual(1);

			const output = result[0]![0]!.json;
			expect(output.domain).toBe(domain);
			expect(output.type).toBe(recordType);
			expect(typeof output.responseCode).toBe('string');

			const answers = output.answers as unknown[];
			if (expectAnswers && output.responseCode === 'NOERROR') {
				expect(answers.length).toBeGreaterThan(0);
			}
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'returns TXT record with raw and parsed SPF structure',
		async () => {
			const context = createSingleServerContext({ recordType: 'TXT' });

			const result = await node.execute.call(context);
			const output = result[0]![0]!.json;
			const answers = output.answers as Array<{ name: string; type: string; value: unknown }>;

			const spfAnswer = answers.find((answer) => {
				const value = answer.value as TxtRecordValue;
				return typeof value.raw === 'string' && value.raw.startsWith('v=spf1');
			});

			expect(spfAnswer).toBeDefined();

			const spfValue = spfAnswer!.value as TxtRecordValue;
			expect(typeof spfValue.raw).toBe('string');
			expect(spfValue.raw.startsWith('v=spf1')).toBe(true);
			expect(spfValue.parsed).not.toBeNull();
			expect(spfValue.parsed!.type).toBe('spf');
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'adds execution hint when server returns a warnable response code',
		async () => {
			const context = createSingleServerContext({ domain: 'servfail.test' });
			const result = await node.execute.call(context);

			expect(result).toHaveLength(1);
			const output = result[0]![0]!.json;
			expect(output.responseCode).toBe('SERVFAIL');

			expect(context.addExecutionHints).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('SERVFAIL'),
					type: 'warning',
				}),
			);
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'throws NodeOperationError when server returns FORMERR',
		async () => {
			const context = createSingleServerContext({ domain: 'formerr.test' });
			await expect(node.execute.call(context)).rejects.toThrow('FORMERR');
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'captures FORMERR as error output when continueOnFail is enabled',
		async () => {
			const context = createMockExecuteContext({
				nodeParameters: {
					domain: 'formerr.test',
					recordType: 'A',
					resolverMode: 'custom',
					customServers: { serverValues: [TEST_SERVER] },
					options: {},
				},
				continueOnFail: true,
			});

			const result = await node.execute.call(context);

			expect(result).toHaveLength(1);
			const output = result[0]![0]!.json;
			expect(output).toHaveProperty('error');
			expect(output.error as string).toContain('FORMERR');
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'adds execution hints for warnable responses in multi-server mode',
		async () => {
			const context = createMockExecuteContext({
				nodeParameters: {
					domain: 'example.com',
					recordType: 'A',
					resolverMode: 'custom',
					customServers: {
						serverValues: [TEST_SERVER, TEST_SERVER],
					},
					options: {},
				},
			});

			const result = await node.execute.call(context);

			expect(result).toHaveLength(1);
			const output = result[0]![0]!.json;
			expect(output).toHaveProperty('results');
			expect(output).toHaveProperty('consistent');
		},
		NETWORK_TEST_TIMEOUT,
	);
});
