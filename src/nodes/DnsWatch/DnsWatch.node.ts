import type {
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	INodeExecutionData,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { DnsRecordType, DnsServerResult } from '../../transport';
import { querySingleServer } from '../../transport';
import type { FormattedRecord } from '../shared/dns-node-helpers';
import {
	assertNotFormerr,
	buildClientOptions,
	buildSingleServerOutput,
	buildWarningMessage,
	extractCustomServers,
	formatServerResult,
	isWarnableResponseCode,
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

interface WatchStaticData {
	previousAnswerHash?: string;
	previousHadRecords?: boolean;
}

export function answersContainValue(answers: FormattedRecord[], expectedValue: string): boolean {
	return answers.some((answer) => {
		const valueAsString =
			typeof answer.value === 'string' ? answer.value : JSON.stringify(answer.value);
		return valueAsString === expectedValue;
	});
}

type FireConditionChecker = (context: {
	currentHash: string;
	previousHash: string;
	currentHasRecords: boolean;
	previousHadRecords: boolean;
	currentAnswers: FormattedRecord[];
	expectedValue: string;
}) => boolean;

const fireConditionCheckers: Record<string, FireConditionChecker> = {
	anyChange: ({ currentHash, previousHash }) => currentHash !== previousHash,
	recordAppears: ({ previousHadRecords, currentHasRecords }) =>
		!previousHadRecords && currentHasRecords,
	recordDisappears: ({ previousHadRecords, currentHasRecords }) =>
		previousHadRecords && !currentHasRecords,
	valueMatches: ({ currentHash, previousHash, currentAnswers, expectedValue }) => {
		if (currentHash === previousHash) return false;
		return answersContainValue(currentAnswers, expectedValue);
	},
};

export function checkFireCondition(
	mode: string,
	context: {
		currentHash: string;
		previousHash: string;
		currentHasRecords: boolean;
		previousHadRecords: boolean;
		currentAnswers: FormattedRecord[];
		expectedValue: string;
	},
): boolean {
	const checker = fireConditionCheckers[mode];
	if (!checker) {
		throw new Error(`Unknown fire condition mode: ${mode}`);
	}
	return checker(context);
}

export class DnsWatch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DNS Watch',
		name: 'dnsWatch',
		icon: 'file:dnsWatch.svg',
		group: ['trigger'],
		version: [1],
		description: 'Watch for DNS record changes by polling',
		defaults: {
			name: 'DNS Watch',
		},
		polling: true,
		inputs: [],
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
				description: 'The domain name to watch',
			},
			{
				displayName: 'Record Type',
				name: 'recordType',
				type: 'options',
				noDataExpression: true,
				options: RECORD_TYPE_OPTIONS,
				default: 'A',
				description: 'The DNS record type to watch',
			},
			{
				displayName: 'Resolver Mode',
				name: 'resolverMode',
				type: 'options',
				noDataExpression: true,
				options: RESOLVER_MODE_OPTIONS,
				default: 'wellKnown',
				description: 'How to select the DNS server to query',
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
					'Public DNS resolver to use for monitoring. The first resolved server is queried on each poll',
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
				description: 'Custom DNS server to query',
			},
			{
				displayName: 'Fire On',
				name: 'fireOn',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Any Change',
						value: 'anyChange',
						description: 'Fire when the DNS answer set changes in any way',
					},
					{
						name: 'Record Appears',
						value: 'recordAppears',
						description: 'Fire when a record appears (e.g. NXDOMAIN transitions to a valid answer)',
					},
					{
						name: 'Record Disappears',
						value: 'recordDisappears',
						description:
							'Fire when a record disappears (e.g. a valid answer transitions to NXDOMAIN)',
					},
					{
						name: 'Value Matches',
						value: 'valueMatches',
						description: 'Fire when the answer changes and contains a specific expected value',
					},
				],
				default: 'anyChange',
				description: 'The condition that triggers the workflow',
			},
			{
				displayName: 'Expected Value',
				name: 'expectedValue',
				type: 'string',
				displayOptions: {
					show: {
						fireOn: ['valueMatches'],
					},
				},
				default: '',
				placeholder: '93.184.216.34',
				description:
					'The value to match against answer records. For simple records (A, AAAA, CNAME), use the plain value. For complex records (MX, SRV), use the JSON representation.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: COMMON_DNS_OPTIONS,
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const domain = this.getNodeParameter('domain') as string;
		const recordType = this.getNodeParameter('recordType') as DnsRecordType;
		const resolverMode = this.getNodeParameter('resolverMode') as string;
		const fireOn = this.getNodeParameter('fireOn') as string;
		const options = this.getNodeParameter('options', {}) as {
			timeout?: number;
			retryCount?: number;
			recursionDesired?: boolean;
		};

		const clientOptions = buildClientOptions(options);

		const wellKnownNames =
			resolverMode === 'wellKnown' ? (this.getNodeParameter('resolvers') as string[]) : [];
		const customServers =
			resolverMode === 'custom'
				? extractCustomServers(this.getNodeParameter('customServers', {}))
				: [];

		let servers;
		try {
			servers = await resolveTargetDnsServers({
				mode: resolverMode,
				wellKnownNames,
				customServers,
				domain,
				clientOptions,
			});
		} catch (error) {
			throw new NodeOperationError(this.getNode(), (error as Error).message);
		}

		if (servers.length === 0) {
			throw new NodeOperationError(
				this.getNode(),
				`No DNS servers resolved for mode "${resolverMode}"`,
			);
		}

		const server = servers[0]!;
		let result: DnsServerResult;
		try {
			result = await querySingleServer(domain, recordType, server, clientOptions);
		} catch (error) {
			throw new NodeOperationError(this.getNode(), `DNS query failed: ${(error as Error).message}`);
		}

		assertNotFormerr(result, domain, this.getNode());
		if (isWarnableResponseCode(result.responseCode)) {
			this.logger.warn(buildWarningMessage(domain, result.server.address, result.responseCode));
		}

		const formatted = formatServerResult(result);
		const currentAnswers = formatted.answers;
		const currentHash = serializeAnswerValues(currentAnswers);
		const currentHasRecords = currentAnswers.length > 0;

		const staticData = this.getWorkflowStaticData('node') as WatchStaticData;

		if (staticData.previousAnswerHash === undefined) {
			staticData.previousAnswerHash = currentHash;
			staticData.previousHadRecords = currentHasRecords;
			return null;
		}

		const expectedValue =
			fireOn === 'valueMatches' ? (this.getNodeParameter('expectedValue') as string) : '';

		const shouldFire = checkFireCondition(fireOn, {
			currentHash,
			previousHash: staticData.previousAnswerHash,
			currentHasRecords,
			previousHadRecords: staticData.previousHadRecords ?? false,
			currentAnswers,
			expectedValue,
		});

		staticData.previousAnswerHash = currentHash;
		staticData.previousHadRecords = currentHasRecords;

		if (!shouldFire) {
			return null;
		}

		const outputJson = buildSingleServerOutput(
			domain,
			recordType,
			result,
		) as unknown as IDataObject;

		return [[{ json: outputJson, pairedItem: { item: 0 } }]];
	}
}
