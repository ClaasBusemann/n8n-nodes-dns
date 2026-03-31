export const DNS_DEFAULT_PORT = 53;
export {
	encodeQuery,
	decodeResponse,
	encodeDomainName,
	RECORD_TYPE_VALUES,
	RECORD_TYPE_NAMES,
	RESPONSE_CODE_NAMES,
} from './dns-packet';
export type {
	DnsRecordType,
	DnsHeader,
	DnsHeaderFlags,
	DnsQuestion,
	DnsResourceRecord,
	DnsResponse,
	QueryFlags,
} from './dns-packet';
export { querySingleServer, queryMultipleServers } from './dns-client';
export type { DnsServer, DnsClientOptions, DnsServerResult, DnsQueryResult } from './dns-client';
