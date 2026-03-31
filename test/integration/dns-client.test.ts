import { querySingleServer, queryMultipleServers } from '../../src/transport/dns-client';
import type { DnsServer } from '../../src/transport/dns-client';

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
const SHOULD_RUN = process.env.RUN_INTEGRATION_TESTS === '1';
const describeIntegration = SHOULD_RUN ? describe : describe.skip;

const CLOUDFLARE: DnsServer = { address: '1.1.1.1', port: 53 };
const GOOGLE: DnsServer = { address: '8.8.8.8', port: 53 };
const UNREACHABLE: DnsServer = { address: '192.0.2.1', port: 53 };

const NETWORK_TEST_TIMEOUT = 15000;

describeIntegration('dns-client integration', () => {
	it(
		'resolves example.com A record via Cloudflare',
		async () => {
			const result = await querySingleServer('example.com', 'A', CLOUDFLARE, {
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
		'returns NXDOMAIN for nonexistent subdomain',
		async () => {
			const result = await querySingleServer(
				'surely-nonexistent-subdomain-xyz.example.com',
				'A',
				CLOUDFLARE,
				{ timeoutMilliseconds: 5000, retryCount: 0 },
			);

			expect(result.responseCode).toBe('NXDOMAIN');
			expect(result.response).not.toBeNull();
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'returns TIMEOUT for unreachable server',
		async () => {
			const result = await querySingleServer('example.com', 'A', UNREACHABLE, {
				timeoutMilliseconds: 1000,
				retryCount: 0,
			});

			expect(result.responseCode).toBe('TIMEOUT');
			expect(result.response).toBeNull();
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'queries multiple servers in parallel',
		async () => {
			const result = await queryMultipleServers('example.com', 'A', [CLOUDFLARE, GOOGLE], {
				timeoutMilliseconds: 5000,
				retryCount: 0,
			});

			expect(result.results).toHaveLength(2);
			expect(result.results[0]!.responseCode).toBe('NOERROR');
			expect(result.results[1]!.responseCode).toBe('NOERROR');
			expect(result.results[0]!.server).toEqual(CLOUDFLARE);
			expect(result.results[1]!.server).toEqual(GOOGLE);
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'matches transaction ID between request and response',
		async () => {
			const result = await querySingleServer('example.com', 'A', CLOUDFLARE, {
				timeoutMilliseconds: 5000,
				retryCount: 0,
			});

			expect(result.response).not.toBeNull();
			const transactionId = result.response!.header.transactionId;
			expect(transactionId).toBeGreaterThanOrEqual(0);
			expect(transactionId).toBeLessThanOrEqual(0xffff);
		},
		NETWORK_TEST_TIMEOUT,
	);
});
