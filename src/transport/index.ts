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
export {
	DNS_DEFAULT_PORT,
	WELL_KNOWN_RESOLVERS,
	parseResolvConf,
	readSystemResolvers,
	getWellKnownServers,
	resolveTargetServers,
} from './dns-resolvers';
export type { WellKnownResolver, ResolverMode, ResolverSelection } from './dns-resolvers';
