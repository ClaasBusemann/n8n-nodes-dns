import type { DnsResourceRecord } from '../transport/dns-packet';
import { decompressName } from './name-compression';

// RFC-defined type values inlined to avoid circular dependency with dns-packet.ts
const TYPE_A = 1;
const TYPE_NS = 2;
const TYPE_CNAME = 5;
const TYPE_SOA = 6;
const TYPE_PTR = 12;
const TYPE_MX = 15;
const TYPE_TXT = 16;
const TYPE_AAAA = 28;
const TYPE_SRV = 33;
const TYPE_NAPTR = 35;
const TYPE_DNSKEY = 48;
const TYPE_TLSA = 52;
const TYPE_CAA = 257;

export interface MxRecordValue {
	priority: number;
	exchange: string;
}

export interface TxtRecordValue {
	raw: string;
}

export interface SrvRecordValue {
	priority: number;
	weight: number;
	port: number;
	target: string;
}

export interface SoaRecordValue {
	mname: string;
	rname: string;
	serial: number;
	refresh: number;
	retry: number;
	expire: number;
	minimum: number;
}

export interface CaaRecordValue {
	flags: number;
	tag: string;
	value: string;
}

export interface NaptrRecordValue {
	order: number;
	preference: number;
	flags: string;
	service: string;
	regexp: string;
	replacement: string;
}

export interface DnskeyRecordValue {
	flags: number;
	protocol: number;
	algorithm: number;
	publicKey: string;
}

export interface TlsaRecordValue {
	usage: number;
	selector: number;
	matchingType: number;
	certificateData: string;
}

export type RecordValue =
	| string
	| MxRecordValue
	| TxtRecordValue
	| SrvRecordValue
	| SoaRecordValue
	| CaaRecordValue
	| NaptrRecordValue
	| DnskeyRecordValue
	| TlsaRecordValue;

type RdataParser = (rdata: Buffer, packet: Buffer, rdataOffset: number) => RecordValue;

const A_RECORD_LENGTH = 4;
const AAAA_RECORD_LENGTH = 16;
const IPV6_GROUP_COUNT = 8;

function parseARecord(rdata: Buffer): RecordValue {
	if (rdata.length < A_RECORD_LENGTH) {
		throw new Error(`A record RDATA expected ${A_RECORD_LENGTH} bytes, got ${rdata.length}`);
	}
	return `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`;
}

function findLongestZeroRun(groups: number[]): { start: number; length: number } {
	let bestStart = -1;
	let bestLength = 0;
	let currentStart = -1;
	let currentLength = 0;

	for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
		if (groups[groupIndex] === 0) {
			if (currentStart === -1) {
				currentStart = groupIndex;
				currentLength = 1;
			} else {
				currentLength++;
			}
		} else {
			if (currentLength > bestLength) {
				bestStart = currentStart;
				bestLength = currentLength;
			}
			currentStart = -1;
			currentLength = 0;
		}
	}

	if (currentLength > bestLength) {
		bestStart = currentStart;
		bestLength = currentLength;
	}

	return { start: bestStart, length: bestLength };
}

function formatIpv6Address(rdata: Buffer): string {
	const groups: number[] = [];
	for (let groupIndex = 0; groupIndex < IPV6_GROUP_COUNT; groupIndex++) {
		groups.push(rdata.readUInt16BE(groupIndex * 2));
	}

	const longestZeroRun = findLongestZeroRun(groups);

	if (longestZeroRun.length < 2) {
		return groups.map((group) => group.toString(16)).join(':');
	}

	const beforeCompression = groups
		.slice(0, longestZeroRun.start)
		.map((group) => group.toString(16));
	const afterCompression = groups
		.slice(longestZeroRun.start + longestZeroRun.length)
		.map((group) => group.toString(16));

	if (beforeCompression.length === 0 && afterCompression.length === 0) {
		return '::';
	}
	if (beforeCompression.length === 0) {
		return `::${afterCompression.join(':')}`;
	}
	if (afterCompression.length === 0) {
		return `${beforeCompression.join(':')}::`;
	}
	return `${beforeCompression.join(':')}::${afterCompression.join(':')}`;
}

function parseAaaaRecord(rdata: Buffer): RecordValue {
	if (rdata.length < AAAA_RECORD_LENGTH) {
		throw new Error(`AAAA record RDATA expected ${AAAA_RECORD_LENGTH} bytes, got ${rdata.length}`);
	}
	return formatIpv6Address(rdata);
}

function parseDomainNameRdata(_rdata: Buffer, packet: Buffer, rdataOffset: number): RecordValue {
	return decompressName(packet, rdataOffset).name;
}

function parseMxRecord(rdata: Buffer, packet: Buffer, rdataOffset: number): RecordValue {
	if (rdata.length < 3) {
		throw new Error(`MX record RDATA expected at least 3 bytes, got ${rdata.length}`);
	}
	const priority = rdata.readUInt16BE(0);
	const { name: exchange } = decompressName(packet, rdataOffset + 2);
	return { priority, exchange } satisfies MxRecordValue;
}

function parseSrvRecord(rdata: Buffer, packet: Buffer, rdataOffset: number): RecordValue {
	if (rdata.length < 7) {
		throw new Error(`SRV record RDATA expected at least 7 bytes, got ${rdata.length}`);
	}
	const priority = rdata.readUInt16BE(0);
	const weight = rdata.readUInt16BE(2);
	const port = rdata.readUInt16BE(4);
	const { name: target } = decompressName(packet, rdataOffset + 6);
	return { priority, weight, port, target } satisfies SrvRecordValue;
}

function parseSoaRecord(rdata: Buffer, packet: Buffer, rdataOffset: number): RecordValue {
	const { name: mname, bytesConsumed: mnameBytes } = decompressName(packet, rdataOffset);
	const { name: rname, bytesConsumed: rnameBytes } = decompressName(
		packet,
		rdataOffset + mnameBytes,
	);
	const integersOffset = mnameBytes + rnameBytes;
	if (rdata.length < integersOffset + 20) {
		throw new Error(
			`SOA record RDATA expected at least ${integersOffset + 20} bytes, got ${rdata.length}`,
		);
	}
	return {
		mname,
		rname,
		serial: rdata.readUInt32BE(integersOffset),
		refresh: rdata.readUInt32BE(integersOffset + 4),
		retry: rdata.readUInt32BE(integersOffset + 8),
		expire: rdata.readUInt32BE(integersOffset + 12),
		minimum: rdata.readUInt32BE(integersOffset + 16),
	} satisfies SoaRecordValue;
}

function readCharacterString(
	buffer: Buffer,
	offset: number,
): { value: string; bytesConsumed: number } {
	if (offset >= buffer.length) {
		throw new Error('Character string extends beyond buffer');
	}
	const stringLength = buffer.readUInt8(offset);
	if (offset + 1 + stringLength > buffer.length) {
		throw new Error(
			`Character string length ${stringLength} extends beyond buffer at offset ${offset}`,
		);
	}
	return {
		value: buffer.toString('utf-8', offset + 1, offset + 1 + stringLength),
		bytesConsumed: 1 + stringLength,
	};
}

function parseNaptrRecord(rdata: Buffer, packet: Buffer, rdataOffset: number): RecordValue {
	if (rdata.length < 5) {
		throw new Error(`NAPTR record RDATA expected at least 5 bytes, got ${rdata.length}`);
	}
	const order = rdata.readUInt16BE(0);
	const preference = rdata.readUInt16BE(2);

	let currentOffset = 4;
	const { value: flags, bytesConsumed: flagsBytes } = readCharacterString(rdata, currentOffset);
	currentOffset += flagsBytes;

	const { value: service, bytesConsumed: serviceBytes } = readCharacterString(rdata, currentOffset);
	currentOffset += serviceBytes;

	const { value: regexp, bytesConsumed: regexpBytes } = readCharacterString(rdata, currentOffset);
	currentOffset += regexpBytes;

	const { name: replacement } = decompressName(packet, rdataOffset + currentOffset);
	return { order, preference, flags, service, regexp, replacement } satisfies NaptrRecordValue;
}

function parseTxtRecord(rdata: Buffer): RecordValue {
	const segments: string[] = [];
	let currentOffset = 0;

	while (currentOffset < rdata.length) {
		const { value, bytesConsumed } = readCharacterString(rdata, currentOffset);
		segments.push(value);
		currentOffset += bytesConsumed;
	}

	return { raw: segments.join('') } satisfies TxtRecordValue;
}

function parseCaaRecord(rdata: Buffer): RecordValue {
	if (rdata.length < 2) {
		throw new Error(`CAA record RDATA expected at least 2 bytes, got ${rdata.length}`);
	}
	const flags = rdata.readUInt8(0);
	const tagLength = rdata.readUInt8(1);
	if (rdata.length < 2 + tagLength) {
		throw new Error(
			`CAA record tag length ${tagLength} extends beyond RDATA of ${rdata.length} bytes`,
		);
	}
	const tag = rdata.toString('ascii', 2, 2 + tagLength);
	const value = rdata.toString('ascii', 2 + tagLength);
	return { flags, tag, value } satisfies CaaRecordValue;
}

function parseDnskeyRecord(rdata: Buffer): RecordValue {
	if (rdata.length < 4) {
		throw new Error(`DNSKEY record RDATA expected at least 4 bytes, got ${rdata.length}`);
	}
	const flags = rdata.readUInt16BE(0);
	const protocol = rdata.readUInt8(2);
	const algorithm = rdata.readUInt8(3);
	const publicKey = rdata.subarray(4).toString('base64');
	return { flags, protocol, algorithm, publicKey } satisfies DnskeyRecordValue;
}

function parseTlsaRecord(rdata: Buffer): RecordValue {
	if (rdata.length < 3) {
		throw new Error(`TLSA record RDATA expected at least 3 bytes, got ${rdata.length}`);
	}
	const usage = rdata.readUInt8(0);
	const selector = rdata.readUInt8(1);
	const matchingType = rdata.readUInt8(2);
	const certificateData = rdata.subarray(3).toString('hex');
	return { usage, selector, matchingType, certificateData } satisfies TlsaRecordValue;
}

const RDATA_PARSERS: Record<number, RdataParser> = {
	[TYPE_A]: parseARecord,
	[TYPE_AAAA]: parseAaaaRecord,
	[TYPE_NS]: parseDomainNameRdata,
	[TYPE_CNAME]: parseDomainNameRdata,
	[TYPE_PTR]: parseDomainNameRdata,
	[TYPE_MX]: parseMxRecord,
	[TYPE_SRV]: parseSrvRecord,
	[TYPE_SOA]: parseSoaRecord,
	[TYPE_NAPTR]: parseNaptrRecord,
	[TYPE_TXT]: parseTxtRecord,
	[TYPE_CAA]: parseCaaRecord,
	[TYPE_DNSKEY]: parseDnskeyRecord,
	[TYPE_TLSA]: parseTlsaRecord,
};

export function parseRdata(record: DnsResourceRecord, packet: Buffer): RecordValue {
	const parser = RDATA_PARSERS[record.recordType];

	if (!parser) {
		return record.rdata.toString('hex');
	}

	try {
		return parser(record.rdata, packet, record.rdataOffset);
	} catch (error) {
		return `[Parse error: ${(error as Error).message}]`;
	}
}
