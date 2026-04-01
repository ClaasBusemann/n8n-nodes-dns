// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports -- test needs to mock fs for system resolver tests
import * as fs from 'fs';
import type { DnsServer } from '../../src/transport/dns-client';

jest.mock('fs', () => ({
	promises: {
		readFile: jest.fn(),
	},
}));

const mockedReadFile = fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>;

import {
	WELL_KNOWN_RESOLVERS,
	parseResolvConf,
	getWellKnownServers,
	readSystemResolvers,
	resolveTargetServers,
} from '../../src/transport/dns-resolvers';

describe('WELL_KNOWN_RESOLVERS', () => {
	it('contains exactly 9 entries', () => {
		expect(WELL_KNOWN_RESOLVERS).toHaveLength(9);
	});

	it('has unique names', () => {
		const names = WELL_KNOWN_RESOLVERS.map((resolver) => resolver.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('has unique primary IPs', () => {
		const primaries = WELL_KNOWN_RESOLVERS.map((resolver) => resolver.primary);
		expect(new Set(primaries).size).toBe(primaries.length);
	});

	it('has unique secondary IPs', () => {
		const secondaries = WELL_KNOWN_RESOLVERS.map((resolver) => resolver.secondary);
		expect(new Set(secondaries).size).toBe(secondaries.length);
	});

	const expectedResolvers = [
		{ name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1' },
		{ name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4' },
		{ name: 'Quad9', primary: '9.9.9.9', secondary: '149.112.112.112' },
		{ name: 'Quad9 Unfiltered', primary: '9.9.9.10', secondary: '149.112.112.10' },
		{ name: 'OpenDNS', primary: '208.67.222.222', secondary: '208.67.220.220' },
		{ name: 'Cloudflare Malware', primary: '1.1.1.2', secondary: '1.0.0.2' },
		{ name: 'Cloudflare Family', primary: '1.1.1.3', secondary: '1.0.0.3' },
		{ name: 'AdGuard', primary: '94.140.14.14', secondary: '94.140.15.15' },
		{ name: 'Control D', primary: '76.76.2.0', secondary: '76.76.10.0' },
	];

	it.each(expectedResolvers)('includes $name with correct IPs', ({ name, primary, secondary }) => {
		const resolver = WELL_KNOWN_RESOLVERS.find((entry) => entry.name === name);
		expect(resolver).toBeDefined();
		expect(resolver!.primary).toBe(primary);
		expect(resolver!.secondary).toBe(secondary);
	});

	it('every entry has a non-empty notes field', () => {
		for (const resolver of WELL_KNOWN_RESOLVERS) {
			expect(resolver.notes.length).toBeGreaterThan(0);
		}
	});
});

describe('parseResolvConf', () => {
	it('extracts nameserver IPs from standard format', () => {
		const content = 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1', '8.8.8.8']);
	});

	it('ignores comment lines starting with #', () => {
		const content = '# This is a comment\nnameserver 1.1.1.1\n# Another comment\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1']);
	});

	it('ignores comment lines starting with ;', () => {
		const content = '; This is a comment\nnameserver 1.1.1.1\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1']);
	});

	it('handles inline comments after nameserver IP', () => {
		const content = 'nameserver 1.1.1.1 # Cloudflare\nnameserver 8.8.8.8 ; Google\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1', '8.8.8.8']);
	});

	it('ignores non-nameserver directives', () => {
		const content = [
			'domain example.com',
			'search example.com local',
			'nameserver 1.1.1.1',
			'options ndots:5',
			'sortlist 130.155.160.0/255.255.240.0',
		].join('\n');
		expect(parseResolvConf(content)).toEqual(['1.1.1.1']);
	});

	it('returns empty array for empty content', () => {
		expect(parseResolvConf('')).toEqual([]);
	});

	it('returns empty array for content with no nameservers', () => {
		const content = '# comment only\ndomain example.com\n';
		expect(parseResolvConf(content)).toEqual([]);
	});

	it('handles IPv6 addresses', () => {
		const content = 'nameserver ::1\nnameserver 2001:4860:4860::8888\n';
		expect(parseResolvConf(content)).toEqual(['::1', '2001:4860:4860::8888']);
	});

	it('handles mixed IPv4 and IPv6 addresses', () => {
		const content = 'nameserver 1.1.1.1\nnameserver ::1\nnameserver 8.8.8.8\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1', '::1', '8.8.8.8']);
	});

	it('handles extra whitespace around nameserver lines', () => {
		const content = '  nameserver   1.1.1.1  \n\tnameserver\t8.8.8.8\t\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1', '8.8.8.8']);
	});

	it('skips blank lines', () => {
		const content = '\n\nnameserver 1.1.1.1\n\n\nnameserver 8.8.8.8\n\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1', '8.8.8.8']);
	});

	it('skips nameserver lines with no IP', () => {
		const content = 'nameserver\nnameserver 1.1.1.1\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1']);
	});

	it('handles Windows-style line endings', () => {
		const content = 'nameserver 1.1.1.1\r\nnameserver 8.8.8.8\r\n';
		expect(parseResolvConf(content)).toEqual(['1.1.1.1', '8.8.8.8']);
	});
});

describe('getWellKnownServers', () => {
	it('returns primary and secondary for a single resolver', () => {
		const servers = getWellKnownServers(['Cloudflare']);
		expect(servers).toEqual([
			{ address: '1.1.1.1', port: 53 },
			{ address: '1.0.0.1', port: 53 },
		]);
	});

	it('returns servers for multiple resolvers in order', () => {
		const servers = getWellKnownServers(['Google', 'Quad9']);
		expect(servers).toEqual([
			{ address: '8.8.8.8', port: 53 },
			{ address: '8.8.4.4', port: 53 },
			{ address: '9.9.9.9', port: 53 },
			{ address: '149.112.112.112', port: 53 },
		]);
	});

	it('returns empty array for empty selection', () => {
		expect(getWellKnownServers([])).toEqual([]);
	});

	it('throws for unknown resolver name', () => {
		expect(() => getWellKnownServers(['NonExistent'])).toThrow('Unknown resolver: "NonExistent"');
	});

	it('throws for unknown name even when mixed with valid names', () => {
		expect(() => getWellKnownServers(['Cloudflare', 'FakeResolver'])).toThrow(
			'Unknown resolver: "FakeResolver"',
		);
	});
});

describe('readSystemResolvers', () => {
	afterEach(() => {
		jest.resetAllMocks();
	});

	it('reads /etc/resolv.conf and returns DnsServer entries', async () => {
		mockedReadFile.mockResolvedValue('nameserver 127.0.0.1\nnameserver ::1\n');

		const servers = await readSystemResolvers();

		expect(mockedReadFile).toHaveBeenCalledWith('/etc/resolv.conf', 'utf-8');
		expect(servers).toEqual([
			{ address: '127.0.0.1', port: 53 },
			{ address: '::1', port: 53 },
		]);
	});

	it('returns empty array when resolv.conf has no nameservers', async () => {
		mockedReadFile.mockResolvedValue('# empty config\ndomain example.com\n');

		const servers = await readSystemResolvers();
		expect(servers).toEqual([]);
	});

	it('propagates file read errors', async () => {
		mockedReadFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));

		await expect(readSystemResolvers()).rejects.toThrow('ENOENT');
	});
});

describe('resolveTargetServers', () => {
	afterEach(() => {
		jest.resetAllMocks();
	});

	it('dispatches wellKnown mode to registry lookup', async () => {
		const servers = await resolveTargetServers('wellKnown', {
			wellKnownNames: ['Cloudflare'],
		});

		expect(servers).toEqual([
			{ address: '1.1.1.1', port: 53 },
			{ address: '1.0.0.1', port: 53 },
		]);
	});

	it('dispatches custom mode to pass-through', async () => {
		const customServers: DnsServer[] = [
			{ address: '10.0.0.1', port: 5353 },
			{ address: '10.0.0.2', port: 53 },
		];

		const servers = await resolveTargetServers('custom', { customServers });
		expect(servers).toEqual(customServers);
	});

	it('returns empty array for custom mode with no servers', async () => {
		const servers = await resolveTargetServers('custom', {});
		expect(servers).toEqual([]);
	});

	it('dispatches system mode to resolv.conf reader', async () => {
		mockedReadFile.mockResolvedValue('nameserver 192.168.1.1\n');

		const servers = await resolveTargetServers('system', {});

		expect(mockedReadFile).toHaveBeenCalledWith('/etc/resolv.conf', 'utf-8');
		expect(servers).toEqual([{ address: '192.168.1.1', port: 53 }]);
	});

	it('returns empty array for wellKnown mode with no names', async () => {
		const servers = await resolveTargetServers('wellKnown', {});
		expect(servers).toEqual([]);
	});
});
