import { querySingleServer } from '../../src/transport/dns-client';
import type { DnsServer } from '../../src/transport/dns-client';
import {
	WELL_KNOWN_RESOLVERS,
	readSystemResolvers,
	DNS_DEFAULT_PORT,
} from '../../src/transport/dns-resolvers';
import { walkDelegationChain } from '../../src/utils/authoritative-discovery';
import { parseRdata } from '../../src/utils/record-parsers';
import type { TxtRecordValue } from '../../src/utils/record-parsers';
import { describeIntegration } from '../helpers/integration-gate';

const CLOUDFLARE: DnsServer = { address: '1.1.1.1', port: DNS_DEFAULT_PORT };
const TXT_RECORD_TYPE = 16;
const NETWORK_TEST_TIMEOUT = 15000;
const WELL_KNOWN_RESOLVER_TIMEOUT = 30000;
const IPV4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;

function extractTxtValues(result: Awaited<ReturnType<typeof querySingleServer>>): TxtRecordValue[] {
	if (!result.response) return [];
	return result.response.answers
		.filter((record) => record.recordType === TXT_RECORD_TYPE)
		.map((record) => parseRdata(record, result.response!.rawPacket) as TxtRecordValue);
}

describeIntegration('resolver-queries integration', () => {
	it(
		'queries each well-known resolver for a stable domain and receives valid answers',
		async () => {
			const queryPromises = WELL_KNOWN_RESOLVERS.map(async (resolver) => {
				const server: DnsServer = { address: resolver.primary, port: DNS_DEFAULT_PORT };
				const result = await querySingleServer('example.com', 'A', server, {
					timeoutMilliseconds: 5000,
					retryCount: 1,
				});
				return { resolverName: resolver.name, result };
			});

			const results = await Promise.all(queryPromises);

			for (const { resolverName, result } of results) {
				expect(result.responseCode).toBe('NOERROR');
				expect(result.response).not.toBeNull();
				expect(result.response!.answers.length).toBeGreaterThan(0);
				expect(result.response!.header.flags.queryResponse).toBe(true);
				// Provide resolver name in failure messages for easier debugging
				expect({ resolver: resolverName, hasAnswers: result.response!.answers.length > 0 }).toEqual(
					expect.objectContaining({ hasAnswers: true }),
				);
			}
		},
		WELL_KNOWN_RESOLVER_TIMEOUT,
	);

	it(
		'discovers authoritative nameservers for a known domain',
		async () => {
			const authoritativeServers = await walkDelegationChain('example.com', {
				recursiveResolver: CLOUDFLARE,
				clientOptions: { timeoutMilliseconds: 5000, retryCount: 1 },
			});

			expect(authoritativeServers.length).toBeGreaterThan(0);
			for (const server of authoritativeServers) {
				expect(server.address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
				expect(server.port).toBe(DNS_DEFAULT_PORT);
			}
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'reads system resolvers from /etc/resolv.conf and executes a query',
		async () => {
			const systemServers = await readSystemResolvers();
			expect(systemServers.length).toBeGreaterThan(0);

			for (const server of systemServers) {
				expect(server.address).toBeTruthy();
				expect(server.port).toBe(DNS_DEFAULT_PORT);
			}

			// Filter to IPv4 addresses since the transport uses udp4 sockets
			const ipv4Servers = systemServers.filter((server) => IPV4_PATTERN.test(server.address));
			if (ipv4Servers.length === 0) return;

			const firstServer = ipv4Servers[0]!;
			const result = await querySingleServer('example.com', 'A', firstServer, {
				timeoutMilliseconds: 5000,
				retryCount: 1,
			});

			expect(result.responseCode).toBe('NOERROR');
			expect(result.response).not.toBeNull();
			expect(result.response!.answers.length).toBeGreaterThan(0);
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'queries _dmarc.google.com TXT and parses DMARC record correctly',
		async () => {
			const result = await querySingleServer('_dmarc.google.com', 'TXT', CLOUDFLARE, {
				timeoutMilliseconds: 5000,
				retryCount: 1,
			});

			expect(result.responseCode).toBe('NOERROR');
			expect(result.response).not.toBeNull();

			const txtValues = extractTxtValues(result);
			expect(txtValues.length).toBeGreaterThan(0);

			const dmarcRecord = txtValues.find((value) => value.raw.startsWith('v=DMARC1'));
			expect(dmarcRecord).toBeDefined();
			expect(dmarcRecord!.raw).toContain('v=DMARC1');
			expect(dmarcRecord!.parsed).not.toBeNull();
			expect(dmarcRecord!.parsed!.type).toBe('dmarc');

			if (dmarcRecord!.parsed!.type === 'dmarc') {
				expect(dmarcRecord!.parsed!.version).toBe('DMARC1');
				expect(dmarcRecord!.parsed!.policy).toBeTruthy();
			}
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'queries google.com TXT and detects SPF record with parsed mechanisms',
		async () => {
			const result = await querySingleServer('google.com', 'TXT', CLOUDFLARE, {
				timeoutMilliseconds: 5000,
				retryCount: 1,
			});

			expect(result.responseCode).toBe('NOERROR');
			expect(result.response).not.toBeNull();

			// google.com has many TXT records; without EDNS0 the UDP response may
			// be truncated with zero answers — verify truncation flag in that case
			if (result.truncated && result.response!.answers.length === 0) {
				expect(result.response!.header.flags.truncated).toBe(true);
				return;
			}

			const txtValues = extractTxtValues(result);
			expect(txtValues.length).toBeGreaterThan(0);

			const spfRecord = txtValues.find((value) => value.raw.startsWith('v=spf1'));
			expect(spfRecord).toBeDefined();
			expect(spfRecord!.raw).toContain('v=spf1');
			expect(spfRecord!.parsed).not.toBeNull();
			expect(spfRecord!.parsed!.type).toBe('spf');

			if (spfRecord!.parsed!.type === 'spf') {
				expect(spfRecord!.parsed!.version).toBe('spf1');
				expect(spfRecord!.parsed!.mechanisms.length).toBeGreaterThan(0);

				const mechanismTypes = spfRecord!.parsed!.mechanisms.map((mechanism) => mechanism.type);
				expect(mechanismTypes).toContain('include');
			}
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'queries DKIM selector TXT and parses public key from multi-string record',
		async () => {
			const result = await querySingleServer('20230601._domainkey.gmail.com', 'TXT', CLOUDFLARE, {
				timeoutMilliseconds: 5000,
				retryCount: 1,
			});

			expect(result.responseCode).toBe('NOERROR');
			expect(result.response).not.toBeNull();

			const txtValues = extractTxtValues(result);
			expect(txtValues.length).toBeGreaterThan(0);

			const dkimRecord = txtValues.find((value) => value.raw.startsWith('v=DKIM1'));
			expect(dkimRecord).toBeDefined();
			expect(dkimRecord!.raw).toContain('v=DKIM1');
			expect(dkimRecord!.parsed).not.toBeNull();
			expect(dkimRecord!.parsed!.type).toBe('dkim');

			if (dkimRecord!.parsed!.type === 'dkim') {
				expect(dkimRecord!.parsed!.version).toBe('DKIM1');
				expect(dkimRecord!.parsed!.keyType).toBe('rsa');
				// DKIM public keys are long base64 strings typically spanning multiple
				// TXT character strings — verify the concatenation produced a valid key
				expect(dkimRecord!.parsed!.publicKey.length).toBeGreaterThan(100);
				expect(dkimRecord!.parsed!.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
			}
		},
		NETWORK_TEST_TIMEOUT,
	);
});
