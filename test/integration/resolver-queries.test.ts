import { querySingleServer } from '../../src/transport/dns-client';
import { readSystemResolvers, DNS_DEFAULT_PORT } from '../../src/transport/dns-resolvers';
import { parseRdata } from '../../src/utils/record-parsers';
import type { TxtRecordValue } from '../../src/utils/record-parsers';
import { describeIntegration } from '../helpers/integration-gate';
import { getTestServer } from '../helpers/test-dns-server';

const TEST_SERVER = getTestServer();
const TXT_RECORD_TYPE = 16;
const NETWORK_TEST_TIMEOUT = 15000;

function extractTxtValues(result: Awaited<ReturnType<typeof querySingleServer>>): TxtRecordValue[] {
	if (!result.response) return [];
	return result.response.answers
		.filter((record) => record.recordType === TXT_RECORD_TYPE)
		.map((record) => parseRdata(record, result.response!.rawPacket) as TxtRecordValue);
}

describeIntegration('resolver-queries integration', () => {
	it(
		'queries test DNS server for a stable domain and receives valid answers',
		async () => {
			const result = await querySingleServer('example.com', 'A', TEST_SERVER, {
				timeoutMilliseconds: 5000,
				retryCount: 1,
			});

			expect(result.responseCode).toBe('NOERROR');
			expect(result.response).not.toBeNull();
			expect(result.response!.answers.length).toBeGreaterThan(0);
			expect(result.response!.header.flags.queryResponse).toBe(true);
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'reads system resolvers from /etc/resolv.conf',
		async () => {
			const systemServers = await readSystemResolvers();
			expect(systemServers.length).toBeGreaterThan(0);

			for (const server of systemServers) {
				expect(server.address).toBeTruthy();
				expect(server.port).toBe(DNS_DEFAULT_PORT);
			}
		},
		NETWORK_TEST_TIMEOUT,
	);

	it(
		'queries _dmarc.google.com TXT and parses DMARC record correctly',
		async () => {
			const result = await querySingleServer('_dmarc.google.com', 'TXT', TEST_SERVER, {
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
			const result = await querySingleServer('google.com', 'TXT', TEST_SERVER, {
				timeoutMilliseconds: 5000,
				retryCount: 1,
			});

			expect(result.responseCode).toBe('NOERROR');
			expect(result.response).not.toBeNull();

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
			const result = await querySingleServer('20230601._domainkey.gmail.com', 'TXT', TEST_SERVER, {
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
				expect(dkimRecord!.parsed!.publicKey.length).toBeGreaterThan(100);
				expect(dkimRecord!.parsed!.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
			}
		},
		NETWORK_TEST_TIMEOUT,
	);
});
