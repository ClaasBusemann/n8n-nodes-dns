import { querySingleServer, queryMultipleServers } from '../../src/transport/dns-client';
import type { DnsServer } from '../../src/transport/dns-client';
import { describeIntegration } from '../helpers/integration-gate';
import { getTestServer } from '../helpers/test-dns-server';

const TEST_SERVER = getTestServer();
const UNREACHABLE: DnsServer = { address: '192.0.2.1', port: 53 };

const NETWORK_TEST_TIMEOUT = 15000;

describeIntegration('dns-client integration', () => {
	it(
		'resolves example.com A record via test DNS server',
		async () => {
			const result = await querySingleServer('example.com', 'A', TEST_SERVER, {
				timeoutMilliseconds: 5000,
				retryCount: 0,
			});

			expect(result.responseCode).toBe('NOERROR');
			expect(result.response).not.toBeNull();
			expect(result.response!.answers.length).toBeGreaterThan(0);
			expect(result.truncated).toBe(false);
			expect(result.responseTimeMilliseconds).toBeGreaterThan(0);
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'returns NXDOMAIN for nonexistent domain',
		async () => {
			const result = await querySingleServer('nonexistent.test', 'A', TEST_SERVER, {
				timeoutMilliseconds: 5000,
				retryCount: 0,
			});

			expect(result.responseCode).toBe('NXDOMAIN');
			expect(result.response).not.toBeNull();
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'returns TIMEOUT for unreachable server after retries are exhausted',
		async () => {
			const perAttemptTimeout = 1000;
			const retryCount = 1;
			const startTime = Date.now();

			const result = await querySingleServer('example.com', 'A', UNREACHABLE, {
				timeoutMilliseconds: perAttemptTimeout,
				retryCount,
			});

			const elapsedMilliseconds = Date.now() - startTime;

			expect(result.responseCode).toBe('TIMEOUT');
			expect(result.response).toBeNull();
			// With 1 retry (2 total attempts × 1 000 ms each), elapsed must exceed a single timeout
			expect(elapsedMilliseconds).toBeGreaterThanOrEqual(
				perAttemptTimeout * (1 + retryCount) - 100,
			);
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'queries multiple servers in parallel',
		async () => {
			const result = await queryMultipleServers('example.com', 'A', [TEST_SERVER, TEST_SERVER], {
				timeoutMilliseconds: 5000,
				retryCount: 0,
			});

			expect(result.results).toHaveLength(2);
			expect(result.results[0]!.responseCode).toBe('NOERROR');
			expect(result.results[1]!.responseCode).toBe('NOERROR');
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'matches transaction ID between request and response',
		async () => {
			const queries = await Promise.all([
				querySingleServer('example.com', 'A', TEST_SERVER, {
					timeoutMilliseconds: 5000,
					retryCount: 0,
				}),
				querySingleServer('github.com', 'A', TEST_SERVER, {
					timeoutMilliseconds: 5000,
					retryCount: 0,
				}),
			]);

			for (const result of queries) {
				expect(result.response).not.toBeNull();
				const transactionId = result.response!.header.transactionId;
				expect(transactionId).toBeGreaterThanOrEqual(0);
				expect(transactionId).toBeLessThanOrEqual(0xffff);
				const rawTransactionId = result.response!.rawPacket.readUInt16BE(0);
				expect(rawTransactionId).toBe(transactionId);
			}

			const firstId = queries[0]!.response!.header.transactionId;
			const secondId = queries[1]!.response!.header.transactionId;
			expect(firstId).not.toBe(secondId);
		},
		NETWORK_TEST_TIMEOUT,
	);
});
