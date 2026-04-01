import type { DnsRecordType, DnsResourceRecord, DnsResponse } from '../transport/dns-packet';
import type { DnsClientOptions, DnsServer, DnsServerResult } from '../transport/dns-client';
import { querySingleServer } from '../transport/dns-client';
import { decompressName } from './name-compression';

// RFC 1035 record type values and standard port — defined locally to avoid
// circular dependency (dns-packet → utils/index → this module → dns-packet)
const NS_TYPE = 2;
const A_TYPE = 1;
const DNS_PORT = 53;

export type QueryFunction = (
	domain: string,
	recordType: DnsRecordType,
	server: DnsServer,
	options?: DnsClientOptions,
) => Promise<DnsServerResult>;

export interface WalkDelegationChainOptions {
	recursiveResolver: DnsServer;
	queryFn?: QueryFunction;
	clientOptions?: DnsClientOptions;
}

function extractNsHostnames(response: DnsResponse): string[] {
	return response.answers
		.filter((record) => record.recordType === NS_TYPE)
		.map((record) => decompressName(response.rawPacket, record.rdataOffset).name);
}

function parseIpFromArdata(rdata: Buffer): string {
	return `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`;
}

function extractGlueRecords(
	response: DnsResponse,
	nameserverHostnames: Set<string>,
): Map<string, string> {
	const glueMap = new Map<string, string>();
	for (const record of response.additionals) {
		if (record.recordType === A_TYPE && nameserverHostnames.has(record.name)) {
			glueMap.set(record.name, parseIpFromArdata(record.rdata));
		}
	}
	return glueMap;
}

function isARecord(record: DnsResourceRecord): boolean {
	return record.recordType === A_TYPE && record.rdataLength === 4;
}

interface ResolveNameserverIpsOptions {
	hostnames: string[];
	glueRecords: Map<string, string>;
	recursiveResolver: DnsServer;
	queryFn: QueryFunction;
	clientOptions?: DnsClientOptions;
}

async function resolveNameserverIps(options: ResolveNameserverIpsOptions): Promise<DnsServer[]> {
	const { hostnames, glueRecords, recursiveResolver, queryFn, clientOptions } = options;
	const servers: DnsServer[] = [];

	for (const hostname of hostnames) {
		const glueIp = glueRecords.get(hostname);
		if (glueIp) {
			servers.push({ address: glueIp, port: DNS_PORT });
			continue;
		}

		try {
			const result = await queryFn(hostname, 'A', recursiveResolver, clientOptions);
			if (!result.response) continue;
			for (const answer of result.response.answers) {
				if (isARecord(answer)) {
					servers.push({ address: parseIpFromArdata(answer.rdata), port: DNS_PORT });
				}
			}
		} catch {
			// Skip nameservers whose hostnames cannot be resolved
		}
	}

	return servers;
}

export async function walkDelegationChain(
	domain: string,
	options: WalkDelegationChainOptions,
): Promise<DnsServer[]> {
	const queryFn = options.queryFn ?? querySingleServer;

	let nsResult: DnsServerResult;
	try {
		nsResult = await queryFn(domain, 'NS', options.recursiveResolver, options.clientOptions);
	} catch {
		return [];
	}

	if (!nsResult.response) return [];

	const nameserverHostnames = extractNsHostnames(nsResult.response);
	if (nameserverHostnames.length === 0) return [];

	const glueRecords = extractGlueRecords(nsResult.response, new Set(nameserverHostnames));

	return resolveNameserverIps({
		hostnames: nameserverHostnames,
		glueRecords,
		recursiveResolver: options.recursiveResolver,
		queryFn,
		...(options.clientOptions !== undefined && { clientOptions: options.clientOptions }),
	});
}
