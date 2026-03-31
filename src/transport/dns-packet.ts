import { randomBytes } from 'crypto';
import { decompressName, DNS_MAX_NAME_LENGTH } from '../utils';

export type DnsRecordType =
	| 'A'
	| 'AAAA'
	| 'MX'
	| 'TXT'
	| 'SRV'
	| 'PTR'
	| 'CAA'
	| 'SOA'
	| 'NS'
	| 'CNAME'
	| 'NAPTR'
	| 'DNSKEY'
	| 'TLSA';

export interface QueryFlags {
	recursionDesired?: boolean;
}

export interface DnsHeaderFlags {
	queryResponse: boolean;
	opcode: number;
	authoritative: boolean;
	truncated: boolean;
	recursionDesired: boolean;
	recursionAvailable: boolean;
	responseCode: number;
}

export interface DnsHeader {
	transactionId: number;
	flags: DnsHeaderFlags;
	questionCount: number;
	answerCount: number;
	authorityCount: number;
	additionalCount: number;
}

export interface DnsQuestion {
	name: string;
	recordType: number;
	recordClass: number;
}

export interface DnsResourceRecord {
	name: string;
	recordType: number;
	recordClass: number;
	ttl: number;
	rdataLength: number;
	rdata: Buffer;
	rdataOffset: number;
}

export interface DnsResponse {
	header: DnsHeader;
	questions: DnsQuestion[];
	answers: DnsResourceRecord[];
	authorities: DnsResourceRecord[];
	additionals: DnsResourceRecord[];
}

export const RECORD_TYPE_VALUES: Record<DnsRecordType, number> = {
	A: 1,
	NS: 2,
	CNAME: 5,
	SOA: 6,
	PTR: 12,
	MX: 15,
	TXT: 16,
	AAAA: 28,
	SRV: 33,
	NAPTR: 35,
	DNSKEY: 48,
	TLSA: 52,
	CAA: 257,
};

export const RECORD_TYPE_NAMES: Record<number, DnsRecordType> = Object.fromEntries(
	Object.entries(RECORD_TYPE_VALUES).map(([name, value]) => [value, name as DnsRecordType]),
) as Record<number, DnsRecordType>;

export const RESPONSE_CODE_NAMES: Record<number, string> = {
	0: 'NOERROR',
	1: 'FORMERR',
	2: 'SERVFAIL',
	3: 'NXDOMAIN',
	4: 'NOTIMP',
	5: 'REFUSED',
};

const HEADER_LENGTH = 12;
const QUERY_CLASS_IN = 1;
const MAX_LABEL_LENGTH = 63;

export function encodeDomainName(domain: string): Buffer {
	if (domain === '') {
		return Buffer.from([0x00]);
	}

	const labels = domain.split('.');
	const segments: Buffer[] = [];
	let nameLength = 0;

	for (const label of labels) {
		if (label.length === 0) {
			throw new Error('DNS domain name contains an empty label');
		}
		if (label.length > MAX_LABEL_LENGTH) {
			throw new Error(
				`DNS label "${label.slice(0, 10)}..." length ${label.length} exceeds maximum of ${MAX_LABEL_LENGTH} bytes`,
			);
		}
		nameLength += (nameLength > 0 ? 1 : 0) + label.length;
		if (nameLength > DNS_MAX_NAME_LENGTH) {
			throw new Error(
				`DNS domain name exceeds maximum length of ${DNS_MAX_NAME_LENGTH} characters`,
			);
		}
		const lengthByte = Buffer.from([label.length]);
		const labelBytes = Buffer.from(label, 'ascii');
		segments.push(lengthByte, labelBytes);
	}

	segments.push(Buffer.from([0x00]));
	return Buffer.concat(segments);
}

function encodeHeader(transactionId: Buffer, flags: QueryFlags, questionCount: number): Buffer {
	const header = Buffer.alloc(HEADER_LENGTH);
	transactionId.copy(header, 0);
	const recursionDesired = flags.recursionDesired ?? true;
	const flagsWord = recursionDesired ? 0x0100 : 0x0000;
	header.writeUInt16BE(flagsWord, 2);
	header.writeUInt16BE(questionCount, 4);
	return header;
}

function encodeQuestion(domain: string, recordType: DnsRecordType): Buffer {
	const encodedName = encodeDomainName(domain);
	const typeAndClass = Buffer.alloc(4);
	typeAndClass.writeUInt16BE(RECORD_TYPE_VALUES[recordType], 0);
	typeAndClass.writeUInt16BE(QUERY_CLASS_IN, 2);
	return Buffer.concat([encodedName, typeAndClass]);
}

export function encodeQuery(domain: string, recordType: DnsRecordType, flags?: QueryFlags): Buffer {
	const transactionId = randomBytes(2);
	const header = encodeHeader(transactionId, flags ?? {}, 1);
	const question = encodeQuestion(domain, recordType);
	return Buffer.concat([header, question]);
}

function decodeHeaderFlags(flagsWord: number): DnsHeaderFlags {
	return {
		queryResponse: (flagsWord & 0x8000) !== 0,
		opcode: (flagsWord >> 11) & 0x0f,
		authoritative: (flagsWord & 0x0400) !== 0,
		truncated: (flagsWord & 0x0200) !== 0,
		recursionDesired: (flagsWord & 0x0100) !== 0,
		recursionAvailable: (flagsWord & 0x0080) !== 0,
		responseCode: flagsWord & 0x000f,
	};
}

function decodeHeader(packet: Buffer): DnsHeader {
	if (packet.length < HEADER_LENGTH) {
		throw new Error(
			`DNS packet too short: expected at least ${HEADER_LENGTH} bytes, got ${packet.length}`,
		);
	}
	return {
		transactionId: packet.readUInt16BE(0),
		flags: decodeHeaderFlags(packet.readUInt16BE(2)),
		questionCount: packet.readUInt16BE(4),
		answerCount: packet.readUInt16BE(6),
		authorityCount: packet.readUInt16BE(8),
		additionalCount: packet.readUInt16BE(10),
	};
}

function decodeQuestion(
	packet: Buffer,
	offset: number,
): { question: DnsQuestion; bytesConsumed: number } {
	const { name, bytesConsumed: nameBytes } = decompressName(packet, offset);
	const typeClassOffset = offset + nameBytes;
	if (typeClassOffset + 4 > packet.length) {
		throw new Error('DNS packet truncated in question section');
	}
	return {
		question: {
			name,
			recordType: packet.readUInt16BE(typeClassOffset),
			recordClass: packet.readUInt16BE(typeClassOffset + 2),
		},
		bytesConsumed: nameBytes + 4,
	};
}

function decodeResourceRecord(
	packet: Buffer,
	offset: number,
): { record: DnsResourceRecord; bytesConsumed: number } {
	const { name, bytesConsumed: nameBytes } = decompressName(packet, offset);
	const fixedFieldsOffset = offset + nameBytes;
	if (fixedFieldsOffset + 10 > packet.length) {
		throw new Error('DNS packet truncated in resource record');
	}
	const recordType = packet.readUInt16BE(fixedFieldsOffset);
	const recordClass = packet.readUInt16BE(fixedFieldsOffset + 2);
	const ttl = packet.readUInt32BE(fixedFieldsOffset + 4);
	const rdataLength = packet.readUInt16BE(fixedFieldsOffset + 8);
	const rdataOffset = fixedFieldsOffset + 10;
	if (rdataOffset + rdataLength > packet.length) {
		throw new Error('DNS packet truncated in resource record RDATA');
	}
	return {
		record: {
			name,
			recordType,
			recordClass,
			ttl,
			rdataLength,
			rdata: Buffer.from(packet.subarray(rdataOffset, rdataOffset + rdataLength)),
			rdataOffset,
		},
		bytesConsumed: nameBytes + 10 + rdataLength,
	};
}

function decodeQuestionSection(
	packet: Buffer,
	offset: number,
	count: number,
): { questions: DnsQuestion[]; offset: number } {
	const questions: DnsQuestion[] = [];
	let currentOffset = offset;
	for (let questionIndex = 0; questionIndex < count; questionIndex++) {
		const { question, bytesConsumed } = decodeQuestion(packet, currentOffset);
		questions.push(question);
		currentOffset += bytesConsumed;
	}
	return { questions, offset: currentOffset };
}

function decodeResourceRecordSection(
	packet: Buffer,
	offset: number,
	count: number,
): { records: DnsResourceRecord[]; offset: number } {
	const records: DnsResourceRecord[] = [];
	let currentOffset = offset;
	for (let recordIndex = 0; recordIndex < count; recordIndex++) {
		const { record, bytesConsumed } = decodeResourceRecord(packet, currentOffset);
		records.push(record);
		currentOffset += bytesConsumed;
	}
	return { records, offset: currentOffset };
}

export function decodeResponse(packet: Buffer): DnsResponse {
	const header = decodeHeader(packet);
	const { questions, offset: afterQuestions } = decodeQuestionSection(
		packet,
		HEADER_LENGTH,
		header.questionCount,
	);
	const { records: answers, offset: afterAnswers } = decodeResourceRecordSection(
		packet,
		afterQuestions,
		header.answerCount,
	);
	const { records: authorities, offset: afterAuthorities } = decodeResourceRecordSection(
		packet,
		afterAnswers,
		header.authorityCount,
	);
	const { records: additionals } = decodeResourceRecordSection(
		packet,
		afterAuthorities,
		header.additionalCount,
	);
	return { header, questions, answers, authorities, additionals };
}
