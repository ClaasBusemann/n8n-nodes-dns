import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { DnsRecordType, DnsServerResult } from '../../transport';
import { queryMultipleServers, querySingleServer } from '../../transport';
import type { FormattedRecord, ServerResultEntry } from '../shared/dns-node-helpers';
import {
	buildClientOptions,
	buildSingleServerOutput,
	extractCustomServers,
	formatServerResult,
	resolveTargetDnsServers,
	serializeAnswerValues,
} from '../shared/dns-node-helpers';
import {
	RECORD_TYPE_OPTIONS,
	RESOLVER_MODE_OPTIONS,
	WELL_KNOWN_RESOLVER_OPTIONS,
	CUSTOM_SERVER_FIELD_VALUES,
	COMMON_DNS_OPTIONS,
} from '../shared/dns-node-properties';

export type { FormattedRecord, ServerResultEntry };
export {
	buildClientOptions,
	buildSingleServerOutput,
	extractCustomServers,
	formatServerResult,
	serializeAnswerValues,
};

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
				options: RECORD_TYPE_OPTIONS,
				default: 'A',
				description: 'The DNS record type to query',
			},
			{
				displayName: 'Resolver Mode',
				name: 'resolverMode',
				type: 'options',
				noDataExpression: true,
				options: RESOLVER_MODE_OPTIONS,
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
				options: WELL_KNOWN_RESOLVER_OPTIONS,
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
						values: CUSTOM_SERVER_FIELD_VALUES,
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
					...COMMON_DNS_OPTIONS,
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

				const servers = await resolveTargetDnsServers({
					mode: resolverMode,
					wellKnownNames,
					customServers,
					domain,
					clientOptions,
				});

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
