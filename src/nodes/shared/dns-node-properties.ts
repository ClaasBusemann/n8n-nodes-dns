import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

export const RECORD_TYPE_OPTIONS: INodePropertyOptions[] = [
	{ name: 'A', value: 'A', description: 'IPv4 address record' },
	{ name: 'AAAA', value: 'AAAA', description: 'IPv6 address record' },
	{ name: 'CAA', value: 'CAA', description: 'Certificate Authority Authorization' },
	{ name: 'CNAME', value: 'CNAME', description: 'Canonical name (alias)' },
	{ name: 'DNSKEY', value: 'DNSKEY', description: 'DNSSEC public key' },
	{ name: 'MX', value: 'MX', description: 'Mail exchange server' },
	{ name: 'NAPTR', value: 'NAPTR', description: 'Naming Authority Pointer' },
	{ name: 'NS', value: 'NS', description: 'Authoritative nameserver' },
	{ name: 'PTR', value: 'PTR', description: 'Pointer record (reverse DNS)' },
	{ name: 'SOA', value: 'SOA', description: 'Start of authority' },
	{ name: 'SRV', value: 'SRV', description: 'Service locator' },
	{ name: 'TLSA', value: 'TLSA', description: 'TLS certificate association' },
	{
		name: 'TXT',
		value: 'TXT',
		description: 'Text record (SPF, DMARC, DKIM, verification)',
	},
];

export const RESOLVER_MODE_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Well-Known',
		value: 'wellKnown',
		description: 'Use public DNS resolvers (Cloudflare, Google, etc.)',
	},
	{
		name: 'Custom',
		value: 'custom',
		description: 'Specify custom DNS server addresses',
	},
	{
		name: 'Authoritative (Auto-Discover)',
		value: 'authoritative',
		description: 'Auto-discover and query the authoritative nameservers for the domain',
	},
	{
		name: 'System',
		value: 'system',
		description: 'Use the system DNS resolver from /etc/resolv.conf',
	},
];

export const WELL_KNOWN_RESOLVER_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'AdGuard',
		value: 'AdGuard',
		description: 'Ad blocking DNS (94.140.14.14)',
	},
	{
		name: 'Cloudflare',
		value: 'Cloudflare',
		description: 'Fastest average response time (1.1.1.1)',
	},
	{
		name: 'Cloudflare Family',
		value: 'Cloudflare Family',
		description: 'Malware + adult content blocking (1.1.1.3)',
	},
	{
		name: 'Cloudflare Malware',
		value: 'Cloudflare Malware',
		description: 'Malware blocking (1.1.1.2)',
	},
	{
		name: 'Control D',
		value: 'Control D',
		description: 'Configurable filtering (76.76.2.0)',
	},
	{
		name: 'Google',
		value: 'Google',
		description: 'Widest adoption (8.8.8.8)',
	},
	{
		name: 'OpenDNS',
		value: 'OpenDNS',
		description: 'Cisco-operated (208.67.222.222)',
	},
	{
		name: 'Quad9',
		value: 'Quad9',
		description: 'Malware blocking enabled (9.9.9.9)',
	},
	{
		name: 'Quad9 Unfiltered',
		value: 'Quad9 Unfiltered',
		description: 'No filtering (9.9.9.10)',
	},
];

export const CUSTOM_SERVER_FIELD_VALUES: INodeProperties[] = [
	{
		displayName: 'IP Address',
		name: 'address',
		type: 'string',
		required: true,
		default: '',
		placeholder: '1.1.1.1',
		description: 'IP address of the DNS server',
	},
	{
		displayName: 'Port',
		name: 'port',
		type: 'number',
		default: 53,
		description: 'UDP port of the DNS server',
	},
];

export const COMMON_DNS_OPTIONS: INodeProperties[] = [
	{
		displayName: 'Recursion Desired',
		name: 'recursionDesired',
		type: 'boolean',
		default: true,
		description: 'Whether to set the RD (Recursion Desired) flag in the DNS query',
	},
	{
		displayName: 'Retry Count',
		name: 'retryCount',
		type: 'number',
		default: 1,
		typeOptions: {
			minValue: 0,
		},
		description: 'Number of retries on timeout',
	},
	{
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: 5000,
		typeOptions: {
			minValue: 100,
		},
		description: 'Per-query timeout in milliseconds',
	},
];
