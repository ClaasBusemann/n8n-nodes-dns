import { DNS_DEFAULT_PORT } from '../../src/transport';
import { DNS_MAX_NAME_LENGTH } from '../../src/utils';
import { DnsLookup } from '../../src/nodes/DnsLookup/DnsLookup.node';
import { DnsWatch } from '../../src/nodes/DnsWatch/DnsWatch.node';
import { DnsServerApi } from '../../src/credentials/DnsServerApi.credentials';

describe('project setup', () => {
	it('should export transport constants', () => {
		expect(DNS_DEFAULT_PORT).toBe(53);
	});

	it('should export utils constants', () => {
		expect(DNS_MAX_NAME_LENGTH).toBe(253);
	});

	it('should define DnsLookup node', () => {
		const node = new DnsLookup();
		expect(node.description.name).toBe('dnsLookup');
	});

	it('should define DnsWatch node', () => {
		const node = new DnsWatch();
		expect(node.description.name).toBe('dnsWatch');
	});

	it('should define DnsServerApi credential', () => {
		const credential = new DnsServerApi();
		expect(credential.name).toBe('dnsServerApi');
	});
});
