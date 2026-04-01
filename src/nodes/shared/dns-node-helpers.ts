import type {
	DnsClientOptions,
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
