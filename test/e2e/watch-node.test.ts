import { DnsWatch } from '../../src/nodes/DnsWatch/DnsWatch.node';
import { createMockPollContext } from '../helpers/mock-execute-context';
import { describeIntegration } from '../helpers/integration-gate';
import { getTestServer } from '../helpers/test-dns-server';

const SINGLE_POLL_TIMEOUT = 15000;
const MULTI_POLL_TIMEOUT = 30000;

const TEST_SERVER = getTestServer();

function createWatchContext(
	staticData: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	return createMockPollContext({
		nodeParameters: {
			domain: 'example.com',
			recordType: 'A',
			resolverMode: 'custom',
			customServers: { serverValues: [TEST_SERVER] },
			fireOn: 'anyChange',
			options: {},
			...overrides,
		},
		staticData,
	});
}

describeIntegration('DnsWatch E2E', () => {
	const node = new DnsWatch();

	it(
		'does not fire on second poll when answers are identical',
		async () => {
			const staticData: Record<string, unknown> = {};

			const firstContext = createWatchContext(staticData);
			const firstResult = await node.poll.call(firstContext);
			expect(firstResult).toBeNull();

			const secondContext = createWatchContext(staticData);
			const secondResult = await node.poll.call(secondContext);
			expect(secondResult).toBeNull();
		},
		MULTI_POLL_TIMEOUT,
	);

	it(
		'fires trigger when answer hash changes',
		async () => {
			const staticData: Record<string, unknown> = {};

			const firstContext = createWatchContext(staticData);
			const firstResult = await node.poll.call(firstContext);
			expect(firstResult).toBeNull();
			expect(staticData.previousAnswerHash).toBeDefined();

			staticData.previousAnswerHash = 'fake-hash-to-simulate-change';

			const secondContext = createWatchContext(staticData);
			const secondResult = await node.poll.call(secondContext);

			expect(secondResult).not.toBeNull();
			expect(secondResult).toHaveLength(1);
			expect(secondResult![0]!.length).toBeGreaterThanOrEqual(1);

			const output = secondResult![0]![0]!.json;
			expect(output.domain).toBe('example.com');
			expect(output.type).toBe('A');
			expect(output).toHaveProperty('answers');
		},
		MULTI_POLL_TIMEOUT,
	);

	it(
		'fires trigger in recordAppears mode when transitioning from no records to records',
		async () => {
			const staticData: Record<string, unknown> = {
				previousAnswerHash: '[]',
				previousHadRecords: false,
			};

			const context = createWatchContext(staticData, {
				fireOn: 'recordAppears',
			});

			const result = await node.poll.call(context);

			expect(result).not.toBeNull();
			expect(result).toHaveLength(1);

			const output = result![0]![0]!.json;
			expect(output.domain).toBe('example.com');
			expect(output).toHaveProperty('answers');
			expect(staticData.previousHadRecords).toBe(true);
		},
		SINGLE_POLL_TIMEOUT,
	);

	it(
		'persists state in getWorkflowStaticData across multiple polls',
		async () => {
			const staticData: Record<string, unknown> = {};

			const firstContext = createWatchContext(staticData);
			await node.poll.call(firstContext);

			expect(typeof staticData.previousAnswerHash).toBe('string');
			expect((staticData.previousAnswerHash as string).length).toBeGreaterThan(0);
			expect(staticData.previousHadRecords).toBe(true);
			const firstHash = staticData.previousAnswerHash;

			const secondContext = createWatchContext(staticData);
			await node.poll.call(secondContext);

			expect(staticData.previousAnswerHash).toBe(firstHash);
			expect(staticData.previousHadRecords).toBe(true);
		},
		MULTI_POLL_TIMEOUT,
	);

	it(
		'fires trigger in recordDisappears mode when records go away',
		async () => {
			const staticData: Record<string, unknown> = {
				previousAnswerHash: 'some-previous-hash',
				previousHadRecords: true,
			};

			const context = createWatchContext(staticData, {
				domain: 'empty.example.com',
				fireOn: 'recordDisappears',
			});

			const result = await node.poll.call(context);

			expect(result).not.toBeNull();
			expect(result).toHaveLength(1);

			const output = result![0]![0]!.json;
			expect(output.domain).toBe('empty.example.com');
			expect(staticData.previousHadRecords).toBe(false);
		},
		SINGLE_POLL_TIMEOUT,
	);

	it(
		'fires trigger in valueMatches mode when answer changes and contains expected value',
		async () => {
			const staticData: Record<string, unknown> = {
				previousAnswerHash: 'old-hash-to-force-change',
				previousHadRecords: true,
			};

			const context = createWatchContext(staticData, {
				fireOn: 'valueMatches',
				expectedValue: '93.184.216.34',
			});

			const result = await node.poll.call(context);

			expect(result).not.toBeNull();
			expect(result).toHaveLength(1);

			const output = result![0]![0]!.json;
			expect(output.domain).toBe('example.com');
			expect(output).toHaveProperty('answers');
		},
		SINGLE_POLL_TIMEOUT,
	);

	it(
		'does not fire in valueMatches mode when expected value is absent',
		async () => {
			const staticData: Record<string, unknown> = {
				previousAnswerHash: 'old-hash-to-force-change',
				previousHadRecords: true,
			};

			const context = createWatchContext(staticData, {
				fireOn: 'valueMatches',
				expectedValue: '10.0.0.1',
			});

			const result = await node.poll.call(context);

			expect(result).toBeNull();
		},
		SINGLE_POLL_TIMEOUT,
	);
});
