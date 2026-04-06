import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type {
	DnsClientOptions,
	DnsRecordType,
	DnsServer,
	DnsServerResult,
	DnsResourceRecord,
} from '../../transport';
import {
	DNS_DEFAULT_PORT,
	WELL_KNOWN_RESOLVERS,
	RECORD_TYPE_NAMES,
	getWellKnownServers,
	readSystemResolvers,
} from '../../transport';
import { walkDelegationChain, parseRdata } from '../../utils';
import type { RecordValue } from '../../utils';

export const AUTHORITATIVE_RECURSIVE_RESOLVER: DnsServer = {
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

export interface ResolveServerOptions {
	mode: string;
	wellKnownNames: string[];
	customServers: DnsServer[];
	domain: string;
	clientOptions: DnsClientOptions;
}

export async function resolveTargetDnsServers(options: ResolveServerOptions): Promise<DnsServer[]> {
	switch (options.mode) {
		case 'wellKnown':
			return getWellKnownServers(options.wellKnownNames);
		case 'custom':
			return options.customServers;
		case 'authoritative':
			return walkDelegationChain(options.domain, {
				recursiveResolver: AUTHORITATIVE_RECURSIVE_RESOLVER,
				clientOptions: options.clientOptions,
			});
		case 'system':
			return readSystemResolvers();
		default:
			throw new Error(`Unknown resolver mode: ${options.mode}`);
	}
}

const WARNABLE_RESPONSE_CODES = new Set(['SERVFAIL', 'REFUSED', 'NOTIMP']);
const FATAL_RESPONSE_CODE = 'FORMERR';

export function isWarnableResponseCode(code: string): boolean {
	return WARNABLE_RESPONSE_CODES.has(code);
}

export function isFatalResponseCode(code: string): boolean {
	return code === FATAL_RESPONSE_CODE;
}

export function buildWarningMessage(
	domain: string,
	serverAddress: string,
	responseCode: string,
): string {
	return `DNS server ${serverAddress} returned ${responseCode} for ${domain}`;
}

export function assertNotFormerr(
	result: DnsServerResult,
	domain: string,
	node: INode,
	itemIndex?: number,
): void {
	if (isFatalResponseCode(result.responseCode)) {
		const message = `DNS server ${result.server.address} returned FORMERR for ${domain} — this indicates a malformed query`;
		const options = itemIndex !== undefined ? { itemIndex } : {};
		throw new NodeOperationError(node, message, options);
	}
}

export function collectResponseWarnings(results: DnsServerResult[], domain: string): string[] {
	return results
		.filter((result) => isWarnableResponseCode(result.responseCode))
		.map((result) => buildWarningMessage(domain, result.server.address, result.responseCode));
}

export interface DnsParameterReader {
	getParam(name: string, fallback?: unknown): unknown;
}

export interface DnsNodeOptions {
	timeout?: number;
	retryCount?: number;
	recursionDesired?: boolean;
	outputConsistencyCheck?: boolean;
}

export interface DnsQueryParams {
	domain: string;
	recordType: DnsRecordType;
	resolverMode: string;
	options: DnsNodeOptions;
	clientOptions: DnsClientOptions;
	servers: DnsServer[];
}

export async function extractDnsQueryParams(reader: DnsParameterReader): Promise<DnsQueryParams> {
	const domain = reader.getParam('domain') as string;
	const recordType = reader.getParam('recordType') as DnsRecordType;
	const resolverMode = reader.getParam('resolverMode') as string;
	const options = reader.getParam('options', {}) as DnsNodeOptions;

	const clientOptions = buildClientOptions(options);

	const wellKnownNames =
		resolverMode === 'wellKnown' ? (reader.getParam('resolvers') as string[]) : [];
	const customServers =
		resolverMode === 'custom' ? extractCustomServers(reader.getParam('customServers', {})) : [];

	const servers = await resolveTargetDnsServers({
		mode: resolverMode,
		wellKnownNames,
		customServers,
		domain,
		clientOptions,
	});

	return { domain, recordType, resolverMode, options, clientOptions, servers };
}
