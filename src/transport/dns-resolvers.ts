// fs is a Node.js built-in required for reading /etc/resolv.conf — not an external dependency
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import * as fs from 'fs';
import type { DnsServer } from './dns-client';

export const DNS_DEFAULT_PORT = 53;
const RESOLV_CONF_PATH = '/etc/resolv.conf';

export interface WellKnownResolver {
	name: string;
	primary: string;
	secondary: string;
	notes: string;
}

export const WELL_KNOWN_RESOLVERS: readonly WellKnownResolver[] = [
	{
		name: 'Cloudflare',
		primary: '1.1.1.1',
		secondary: '1.0.0.1',
		notes: 'Fastest average response time',
	},
	{ name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4', notes: 'Widest adoption' },
	{
		name: 'Quad9',
		primary: '9.9.9.9',
		secondary: '149.112.112.112',
		notes: 'Malware blocking enabled',
	},
	{
		name: 'Quad9 Unfiltered',
		primary: '9.9.9.10',
		secondary: '149.112.112.10',
		notes: 'No filtering',
	},
	{
		name: 'OpenDNS',
		primary: '208.67.222.222',
		secondary: '208.67.220.220',
		notes: 'Cisco-operated',
	},
	{
		name: 'Cloudflare Malware',
		primary: '1.1.1.2',
		secondary: '1.0.0.2',
		notes: 'Malware blocking',
	},
	{
		name: 'Cloudflare Family',
		primary: '1.1.1.3',
		secondary: '1.0.0.3',
		notes: 'Malware + adult content blocking',
	},
	{ name: 'AdGuard', primary: '94.140.14.14', secondary: '94.140.15.15', notes: 'Ad blocking' },
	{
		name: 'Control D',
		primary: '76.76.2.0',
		secondary: '76.76.10.0',
		notes: 'Configurable filtering',
	},
];

const resolversByName = new Map<string, WellKnownResolver>(
	WELL_KNOWN_RESOLVERS.map((resolver) => [resolver.name, resolver]),
);

function removeComment(line: string): string {
	return line.replace(/[#;].*$/, '');
}

export function parseResolvConf(content: string): string[] {
	const nameservers: string[] = [];
	for (const rawLine of content.split('\n')) {
		const line = removeComment(rawLine).trim();
		const tokens = line.split(/\s+/);
		if (tokens[0] === 'nameserver' && tokens[1]) {
			nameservers.push(tokens[1]);
		}
	}
	return nameservers;
}

export async function readSystemResolvers(): Promise<DnsServer[]> {
	const content = await fs.promises.readFile(RESOLV_CONF_PATH, 'utf-8');
	const addresses = parseResolvConf(content);
	return addresses.map((address) => ({ address, port: DNS_DEFAULT_PORT }));
}

export function getWellKnownServers(resolverNames: string[]): DnsServer[] {
	const servers: DnsServer[] = [];
	for (const name of resolverNames) {
		const resolver = resolversByName.get(name);
		if (!resolver) {
			throw new Error(`Unknown resolver: "${name}"`);
		}
		servers.push(
			{ address: resolver.primary, port: DNS_DEFAULT_PORT },
			{ address: resolver.secondary, port: DNS_DEFAULT_PORT },
		);
	}
	return servers;
}

export type ResolverMode = 'wellKnown' | 'custom' | 'system';

export interface ResolverSelection {
	wellKnownNames?: string[];
	customServers?: DnsServer[];
}

export async function resolveTargetServers(
	mode: ResolverMode,
	selection: ResolverSelection,
): Promise<DnsServer[]> {
	switch (mode) {
		case 'wellKnown':
			return getWellKnownServers(selection.wellKnownNames ?? []);
		case 'custom':
			return selection.customServers ?? [];
		case 'system':
			return readSystemResolvers();
	}
}
