import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	DnsRecordType,
	DnsClientOptions,
	DnsServer,
	DnsServerResult,
	DnsResourceRecord,
} from '../../transport';
import {
	querySingleServer,
	queryMultipleServers,
	getWellKnownServers,
	readSystemResolvers,
	WELL_KNOWN_RESOLVERS,
	RECORD_TYPE_NAMES,
	DNS_DEFAULT_PORT,
} from '../../transport';
import { walkDelegationChain, parseRdata } from '../../utils';
import type { RecordValue } from '../../utils';

const AUTHORITATIVE_RECURSIVE_RESOLVER: DnsServer = {
	address: '1.1.1.1',
	port: DNS_DEFAULT_PORT,
};

const ipToResolverName = new Map<string, string>();
for (const resolver of WELL_KNOWN_RESOLVERS) {
	ipToResolverName.set(resolver.primary, resolver.name);
	ipToResolverName.set(resolver.secondary, resolver.name);
}

function getServerName(address: string): string {
	return ipToResolverName.get(address) ?? address;
}

export interface FormattedRecord {
	name: string;
	type: string;
	ttl: number;
	value: RecordValue;
}

function formatResourceRecords(records: DnsResourceRecord[], rawPacket: Buffer): FormattedRecord[] {
	return records.map((record) => ({
		name: record.name,
		type: RECORD_TYPE_NAMES[record.recordType] ?? `TYPE${record.recordType}`,
		ttl: record.ttl,
		value: parseRdata(record, rawPacket),
	}));
}

export interface ServerResultEntry {
	server: string;
	serverName: string;
	authoritative: boolean;
	responseCode: string;
	responseTimeMs: number;
	answers: FormattedRecord[];
	authority: FormattedRecord[];
	additional: FormattedRecord[];
	truncated?: boolean;
}

export function formatServerResult(result: DnsServerResult): ServerResultEntry {
	const response = result.response;
	const entry: ServerResultEntry = {
		server: result.server.address,
		serverName: getServerName(result.server.address),
		authoritative: response?.header.flags.authoritative ?? false,
		responseCode: result.responseCode,
		responseTimeMs: result.responseTimeMilliseconds,
		answers: response ? formatResourceRecords(response.answers, response.rawPacket) : [],
		authority: response ? formatResourceRecords(response.authorities, response.rawPacket) : [],
		additional: response ? formatResourceRecords(response.additionals, response.rawPacket) : [],
	};

	if (result.truncated) {
		entry.truncated = true;
	}

	return entry;
}

export function buildSingleServerOutput(
	domain: string,
	recordType: string,
	result: DnsServerResult,
): Record<string, unknown> {
	return {
		domain,
		type: recordType,
		...formatServerResult(result),
	};
}

export function serializeAnswerValues(answers: FormattedRecord[]): string {
	const normalized = answers
		.map((answer) => JSON.stringify({ name: answer.name, type: answer.type, value: answer.value }))
		.sort();
	return JSON.stringify(normalized);
}

export function computeConsistencyFlags(entries: ServerResultEntry[]): {
	consistent: boolean;
	propagatedToAll: boolean;
	uniqueAnswers: number;
} {
	const answerSets = entries.map((entry) => serializeAnswerValues(entry.answers));
	const uniqueSet = new Set(answerSets);
	const consistent = uniqueSet.size <= 1;

	const authoritativeEntries = entries.filter((entry) => entry.authoritative);
	let propagatedToAll = consistent;

	if (authoritativeEntries.length > 0) {
		const authAnswerSet = serializeAnswerValues(authoritativeEntries[0]!.answers);
		const nonAuthEntries = entries.filter((entry) => !entry.authoritative);
		propagatedToAll = nonAuthEntries.every(
			(entry) => serializeAnswerValues(entry.answers) === authAnswerSet,
		);
	}

	return { consistent, propagatedToAll, uniqueAnswers: uniqueSet.size };
}

export function buildMultiServerOutput(
	domain: string,
	recordType: string,
	results: DnsServerResult[],
	consistencyCheck: boolean,
): Record<string, unknown> {
	const entries = results.map(formatServerResult);

	const output: Record<string, unknown> = {
		domain,
		type: recordType,
		results: entries,
	};

	if (consistencyCheck) {
		const flags = computeConsistencyFlags(entries);
		output.consistent = flags.consistent;
		output.propagatedToAll = flags.propagatedToAll;
		output.serverCount = results.length;
		output.uniqueAnswers = flags.uniqueAnswers;
	}

	return output;
}

async function resolveTargetDnsServers(
	mode: string,
	wellKnownNames: string[],
	customServers: DnsServer[],
	domain: string,
	clientOptions: DnsClientOptions,
): Promise<DnsServer[]> {
	switch (mode) {
		case 'wellKnown':
			return getWellKnownServers(wellKnownNames);
		case 'custom':
			return customServers;
		case 'authoritative':
			return walkDelegationChain(domain, {
				recursiveResolver: AUTHORITATIVE_RECURSIVE_RESOLVER,
				clientOptions,
			});
		case 'system':
			return readSystemResolvers();
		default:
			throw new Error(`Unknown resolver mode: ${mode}`);
	}
}

export function buildClientOptions(options: {
	timeout?: number;
	retryCount?: number;
	recursionDesired?: boolean;
}): DnsClientOptions {
	return {
		...(options.timeout !== undefined && { timeoutMilliseconds: options.timeout }),
		...(options.retryCount !== undefined && { retryCount: options.retryCount }),
		...(options.recursionDesired !== undefined && {
			recursionDesired: options.recursionDesired,
		}),
	};
}

export function extractCustomServers(paramValue: unknown): DnsServer[] {
	const collection = paramValue as {
		serverValues?: Array<{ address: string; port: number }>;
	};
	return (collection.serverValues ?? []).map((server) => ({
		address: server.address,
		port: server.port ?? DNS_DEFAULT_PORT,
	}));
}

export class DnsLookup implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DNS Lookup',
		name: 'dnsLookup',
		icon: 'file:dnsLookup.svg',
		group: ['input'],
		version: [1],
		subtitle: '={{$parameter["recordType"] + " lookup"}}',
		description: 'Perform raw DNS queries using the DNS wire protocol',
		defaults: {
			name: 'DNS Lookup',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'dnsServerApi',
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Domain',
				name: 'domain',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'example.com',
				description: 'The domain name to query',
			},
			{
				displayName: 'Record Type',
				name: 'recordType',
				type: 'options',
				noDataExpression: true,
				options: [
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
				],
				default: 'A',
				description: 'The DNS record type to query',
			},
			{
				displayName: 'Resolver Mode',
				name: 'resolverMode',
				type: 'options',
				noDataExpression: true,
				options: [
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
				],
				default: 'wellKnown',
				description: 'How to select the DNS servers to query',
			},
			{
				displayName: 'Resolvers',
				name: 'resolvers',
				type: 'multiOptions',
				displayOptions: {
					show: {
						resolverMode: ['wellKnown'],
					},
				},
				options: [
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
				],
				default: ['Cloudflare'],
				description:
					'Public DNS resolvers to query (each resolver uses both primary and secondary servers)',
			},
			{
				displayName: 'Custom Servers',
				name: 'customServers',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						resolverMode: ['custom'],
					},
				},
				default: {},
				placeholder: 'Add Server',
				options: [
					{
						name: 'serverValues',
						displayName: 'Server',
						values: [
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
						],
					},
				],
				description: 'Custom DNS servers to query',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Output Consistency Check',
						name: 'outputConsistencyCheck',
						type: 'boolean',
						default: true,
						description:
							'Whether to add consistency and propagation flags when querying multiple servers',
					},
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
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const domain = this.getNodeParameter('domain', itemIndex) as string;
				const recordType = this.getNodeParameter('recordType', itemIndex) as DnsRecordType;
				const resolverMode = this.getNodeParameter('resolverMode', itemIndex) as string;
				const options = this.getNodeParameter('options', itemIndex, {}) as {
					timeout?: number;
					retryCount?: number;
					recursionDesired?: boolean;
					outputConsistencyCheck?: boolean;
				};

				const clientOptions = buildClientOptions(options);

				const wellKnownNames =
					resolverMode === 'wellKnown'
						? (this.getNodeParameter('resolvers', itemIndex) as string[])
						: [];
				const customServers =
					resolverMode === 'custom'
						? extractCustomServers(this.getNodeParameter('customServers', itemIndex, {}))
						: [];

				const servers = await resolveTargetDnsServers(
					resolverMode,
					wellKnownNames,
					customServers,
					domain,
					clientOptions,
				);

				if (servers.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						`No DNS servers resolved for mode "${resolverMode}"`,
						{ itemIndex },
					);
				}

				const isSingleServer = servers.length === 1;
				let outputJson: IDataObject;

				if (isSingleServer) {
					const result = await querySingleServer(domain, recordType, servers[0]!, clientOptions);
					outputJson = buildSingleServerOutput(
						domain,
						recordType,
						result,
					) as unknown as IDataObject;
				} else {
					const queryResult = await queryMultipleServers(
						domain,
						recordType,
						servers,
						clientOptions,
					);
					const consistencyCheck = options.outputConsistencyCheck !== false;
					outputJson = buildMultiServerOutput(
						domain,
						recordType,
						queryResult.results,
						consistencyCheck,
					) as unknown as IDataObject;
				}

				returnData.push({
					json: outputJson,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
					throw error;
				}

				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
