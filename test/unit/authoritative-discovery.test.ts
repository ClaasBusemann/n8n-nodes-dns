import { walkDelegationChain } from '../../src/utils/authoritative-discovery';
import type { QueryFunction } from '../../src/utils/authoritative-discovery';
import {
	decodeResponse,
	encodeDomainName,
	RECORD_TYPE_VALUES,
} from '../../src/transport/dns-packet';
import type { DnsServer, DnsServerResult } from '../../src/transport/dns-client';

const RECURSIVE_RESOLVER: DnsServer = { address: '1.1.1.1', port: 53 };

function buildResponsePacket(options: {
	questionDomain: string;
	questionType: number;
	answerRecords?: { name: string; type: number; ttl: number; rdata: Buffer }[];
	additionalRecords?: { name: string; type: number; ttl: number; rdata: Buffer }[];
}): Buffer {
	const questionName = encodeDomainName(options.questionDomain);
	const answers = options.answerRecords ?? [];
	const additionals = options.additionalRecords ?? [];

	const header = Buffer.alloc(12);
	header.writeUInt16BE(0x1234, 0);
	header.writeUInt16BE(0x8180, 2);
	header.writeUInt16BE(1, 4);
	header.writeUInt16BE(answers.length, 6);
	header.writeUInt16BE(0, 8);
	header.writeUInt16BE(additionals.length, 10);

	const questionTypeClass = Buffer.alloc(4);
	questionTypeClass.writeUInt16BE(options.questionType, 0);
	questionTypeClass.writeUInt16BE(1, 2);

	const recordBuffers: Buffer[] = [];
	for (const record of [...answers, ...additionals]) {
		const nameEncoded = encodeDomainName(record.name);
		const fields = Buffer.alloc(10);
		fields.writeUInt16BE(record.type, 0);
		fields.writeUInt16BE(1, 2);
		fields.writeUInt32BE(record.ttl, 4);
		fields.writeUInt16BE(record.rdata.length, 8);
		recordBuffers.push(nameEncoded, fields, record.rdata);
	}

	return Buffer.concat([header, questionName, questionTypeClass, ...recordBuffers]);
}

function buildSuccessResult(packet: Buffer): DnsServerResult {
	return {
		server: RECURSIVE_RESOLVER,
		response: decodeResponse(packet),
		responseCode: 'NOERROR',
		truncated: false,
		responseTimeMilliseconds: 10,
	};
}

function buildTimeoutResult(): DnsServerResult {
	return {
		server: RECURSIVE_RESOLVER,
		response: null,
		responseCode: 'TIMEOUT',
		truncated: false,
		responseTimeMilliseconds: 0,
	};
}

function ipToBuffer(ip: string): Buffer {
	const octets = ip.split('.').map(Number);
	return Buffer.from(octets);
}

describe('walkDelegationChain', () => {
	it('should perform a two-step delegation chain walk (NS then A queries)', async () => {
		const nsPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns1.example.com'),
				},
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns2.example.com'),
				},
			],
		});

		const ns1APacket = buildResponsePacket({
			questionDomain: 'ns1.example.com',
			questionType: RECORD_TYPE_VALUES.A,
			answerRecords: [
				{
					name: 'ns1.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('192.0.2.1'),
				},
			],
		});

		const ns2APacket = buildResponsePacket({
			questionDomain: 'ns2.example.com',
			questionType: RECORD_TYPE_VALUES.A,
			answerRecords: [
				{
					name: 'ns2.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('192.0.2.2'),
				},
			],
		});

		const queryFn: QueryFunction = jest.fn(async (domain, recordType) => {
			if (domain === 'example.com' && recordType === 'NS') {
				return buildSuccessResult(nsPacket);
			}
			if (domain === 'ns1.example.com' && recordType === 'A') {
				return buildSuccessResult(ns1APacket);
			}
			if (domain === 'ns2.example.com' && recordType === 'A') {
				return buildSuccessResult(ns2APacket);
			}
			throw new Error(`Unexpected query: ${domain} ${recordType}`);
		});

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([
			{ address: '192.0.2.1', port: 53 },
			{ address: '192.0.2.2', port: 53 },
		]);
		expect(queryFn).toHaveBeenCalledTimes(3);
	});

	it('should skip A queries when glue records are present in the additional section', async () => {
		const nsPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns1.example.com'),
				},
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns2.example.com'),
				},
			],
			additionalRecords: [
				{
					name: 'ns1.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('198.51.100.1'),
				},
				{
					name: 'ns2.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('198.51.100.2'),
				},
			],
		});

		const queryFn: QueryFunction = jest.fn(async () => buildSuccessResult(nsPacket));

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([
			{ address: '198.51.100.1', port: 53 },
			{ address: '198.51.100.2', port: 53 },
		]);
		// Only the initial NS query — no A queries needed
		expect(queryFn).toHaveBeenCalledTimes(1);
	});

	it('should use glue records for some nameservers and A queries for others', async () => {
		const nsPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns1.example.com'),
				},
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns2.example.net'),
				},
			],
			additionalRecords: [
				{
					name: 'ns1.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('198.51.100.1'),
				},
			],
		});

		const ns2APacket = buildResponsePacket({
			questionDomain: 'ns2.example.net',
			questionType: RECORD_TYPE_VALUES.A,
			answerRecords: [
				{
					name: 'ns2.example.net',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('203.0.113.2'),
				},
			],
		});

		const queryFn: QueryFunction = jest.fn(async (domain, recordType) => {
			if (domain === 'example.com' && recordType === 'NS') {
				return buildSuccessResult(nsPacket);
			}
			if (domain === 'ns2.example.net' && recordType === 'A') {
				return buildSuccessResult(ns2APacket);
			}
			throw new Error(`Unexpected query: ${domain} ${recordType}`);
		});

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([
			{ address: '198.51.100.1', port: 53 },
			{ address: '203.0.113.2', port: 53 },
		]);
		expect(queryFn).toHaveBeenCalledTimes(2);
	});

	it('should return an empty array when the NS query throws', async () => {
		const queryFn: QueryFunction = jest.fn(async () => {
			throw new Error('Network error');
		});

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([]);
	});

	it('should return an empty array when the NS query times out (null response)', async () => {
		const queryFn: QueryFunction = jest.fn(async () => buildTimeoutResult());

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([]);
	});

	it('should return an empty array when the NS response has no NS records', async () => {
		const emptyPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [],
		});

		const queryFn: QueryFunction = jest.fn(async () => buildSuccessResult(emptyPacket));

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([]);
		expect(queryFn).toHaveBeenCalledTimes(1);
	});

	it('should skip nameservers whose A record lookup fails', async () => {
		const nsPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns1.example.com'),
				},
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns2.example.com'),
				},
			],
		});

		const ns2APacket = buildResponsePacket({
			questionDomain: 'ns2.example.com',
			questionType: RECORD_TYPE_VALUES.A,
			answerRecords: [
				{
					name: 'ns2.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('192.0.2.2'),
				},
			],
		});

		const queryFn: QueryFunction = jest.fn(async (domain, recordType) => {
			if (domain === 'example.com' && recordType === 'NS') {
				return buildSuccessResult(nsPacket);
			}
			if (domain === 'ns1.example.com' && recordType === 'A') {
				throw new Error('DNS query failed');
			}
			if (domain === 'ns2.example.com' && recordType === 'A') {
				return buildSuccessResult(ns2APacket);
			}
			throw new Error(`Unexpected query: ${domain} ${recordType}`);
		});

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([{ address: '192.0.2.2', port: 53 }]);
	});

	it('should skip nameservers whose A record lookup times out', async () => {
		const nsPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns1.example.com'),
				},
			],
		});

		const queryFn: QueryFunction = jest.fn(async (domain, recordType) => {
			if (domain === 'example.com' && recordType === 'NS') {
				return buildSuccessResult(nsPacket);
			}
			if (domain === 'ns1.example.com' && recordType === 'A') {
				return buildTimeoutResult();
			}
			throw new Error(`Unexpected query: ${domain} ${recordType}`);
		});

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([]);
	});

	it('should pass clientOptions through to the query function', async () => {
		const nsPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [],
		});

		const clientOptions = { timeoutMilliseconds: 2000, retryCount: 3 };
		const queryFn: QueryFunction = jest.fn(async () => buildSuccessResult(nsPacket));

		await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
			clientOptions,
		});

		expect(queryFn).toHaveBeenCalledWith('example.com', 'NS', RECURSIVE_RESOLVER, clientOptions);
	});

	it('should pass the recursive resolver to all queries', async () => {
		const customResolver: DnsServer = { address: '9.9.9.9', port: 53 };

		const nsPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns1.example.com'),
				},
			],
		});

		const ns1APacket = buildResponsePacket({
			questionDomain: 'ns1.example.com',
			questionType: RECORD_TYPE_VALUES.A,
			answerRecords: [
				{
					name: 'ns1.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('192.0.2.1'),
				},
			],
		});

		const queryFn: QueryFunction = jest.fn(async (domain, recordType) => {
			if (recordType === 'NS') return buildSuccessResult(nsPacket);
			return buildSuccessResult(ns1APacket);
		});

		await walkDelegationChain('example.com', {
			recursiveResolver: customResolver,
			queryFn,
		});

		expect(queryFn).toHaveBeenCalledWith('example.com', 'NS', customResolver, undefined);
		expect(queryFn).toHaveBeenCalledWith('ns1.example.com', 'A', customResolver, undefined);
	});

	it('should handle a nameserver with multiple A records', async () => {
		const nsPacket = buildResponsePacket({
			questionDomain: 'example.com',
			questionType: RECORD_TYPE_VALUES.NS,
			answerRecords: [
				{
					name: 'example.com',
					type: RECORD_TYPE_VALUES.NS,
					ttl: 3600,
					rdata: encodeDomainName('ns1.example.com'),
				},
			],
		});

		const ns1APacket = buildResponsePacket({
			questionDomain: 'ns1.example.com',
			questionType: RECORD_TYPE_VALUES.A,
			answerRecords: [
				{
					name: 'ns1.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('192.0.2.1'),
				},
				{
					name: 'ns1.example.com',
					type: RECORD_TYPE_VALUES.A,
					ttl: 3600,
					rdata: ipToBuffer('192.0.2.2'),
				},
			],
		});

		const queryFn: QueryFunction = jest.fn(async (domain, recordType) => {
			if (recordType === 'NS') return buildSuccessResult(nsPacket);
			return buildSuccessResult(ns1APacket);
		});

		const servers = await walkDelegationChain('example.com', {
			recursiveResolver: RECURSIVE_RESOLVER,
			queryFn,
		});

		expect(servers).toEqual([
			{ address: '192.0.2.1', port: 53 },
			{ address: '192.0.2.2', port: 53 },
		]);
	});
});
