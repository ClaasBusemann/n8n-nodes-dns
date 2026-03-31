import type { ICredentialType, INodeProperties } from 'n8n-workflow';

// DNS has no authentication mechanism — there is no equivalent of GET /health.
// Connection failures surface at execution time. Suppress credential-test-required.
// eslint-disable-next-line @n8n/community-nodes/credential-test-required
export class DnsServerApi implements ICredentialType {
	name = 'dnsServerApi';
	displayName = 'DNS Server';
	icon = 'file:dnsServerApi.svg' as const;
	properties: INodeProperties[] = [
		{
			displayName: 'Server',
			name: 'server',
			type: 'string',
			default: '',
			placeholder: '1.1.1.1',
			description: 'IP address or hostname of the DNS server',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 53,
			description: 'UDP port of the DNS server',
		},
	];
}
