// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports -- Node.js built-in: UDP server for integration tests
import * as dgram from 'dgram';
import { encodeDomainName, RECORD_TYPE_VALUES } from '../../src/transport/dns-packet';
import type { DnsServer } from '../../src/transport/dns-client';

const CLASS_IN = 1;
const DEFAULT_TTL = 3600;
const HEADER_SIZE = 12;
const FLAG_QR_RESPONSE = 0x8000;
const FLAG_AUTHORITATIVE = 0x0400;
const FLAG_RECURSION_DESIRED = 0x0100;

interface RawRecord {
	type: number;
	rdata: Buffer;
}

type ZoneMap = Map<string, RawRecord[]>;

function isCompressionPointer(lengthByte: number): boolean {
	return (lengthByte & 0xc0) === 0xc0;
}

function resolvePointer(
	packet: Buffer,
	position: number,
	labels: string[],
): { name: string; nextOffset: number } {
	const pointer = packet.readUInt16BE(position) & 0x3fff;
	const result = parseQueryName(packet, pointer);
	labels.push(result.name);
	return { name: labels.join('.'), nextOffset: position + 2 };
}

function parseQueryName(packet: Buffer, offset: number): { name: string; nextOffset: number } {
	const labels: string[] = [];
	let position = offset;

	while (position < packet.length) {
		const length = packet[position]!;
		if (length === 0) {
			position++;
			break;
		}
		if (isCompressionPointer(length)) {
			return resolvePointer(packet, position, labels);
		}
		position++;
		labels.push(packet.subarray(position, position + length).toString('ascii'));
		position += length;
	}

	return { name: labels.join('.'), nextOffset: position };
}

function buildResponseHeader(
	transactionId: Buffer,
	responseCode: number,
	questionCount: number,
	answerCount: number,
	authoritative: boolean,
): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	transactionId.copy(header, 0);
	let flags = FLAG_QR_RESPONSE;
	if (authoritative) flags |= FLAG_AUTHORITATIVE;
	flags |= FLAG_RECURSION_DESIRED;
	flags |= responseCode & 0x0f;
	header.writeUInt16BE(flags, 2);
	header.writeUInt16BE(questionCount, 4);
	header.writeUInt16BE(answerCount, 6);
	return header;
}

function buildAnswerRecord(name: string, recordType: number, rdata: Buffer): Buffer {
	const encodedName = encodeDomainName(name);
	const meta = Buffer.alloc(10);
	meta.writeUInt16BE(recordType, 0);
	meta.writeUInt16BE(CLASS_IN, 2);
	meta.writeUInt32BE(DEFAULT_TTL, 4);
	meta.writeUInt16BE(rdata.length, 8);
	return Buffer.concat([encodedName, meta, rdata]);
}

function buildResponse(
	query: Buffer,
	queryName: string,
	questionEnd: number,
	records: RawRecord[],
	authoritative: boolean,
): Buffer {
	const transactionId = query.subarray(0, 2);
	const questionSection = query.subarray(HEADER_SIZE, questionEnd);
	const responseCode = records.length > 0 ? 0 : 3; // NOERROR or NXDOMAIN
	const header = buildResponseHeader(transactionId, responseCode, 1, records.length, authoritative);
	const answerBuffers = records.map((record) =>
		buildAnswerRecord(queryName, record.type, record.rdata),
	);
	return Buffer.concat([header, questionSection, ...answerBuffers]);
}

function encodeIpv4(ip: string): Buffer {
	const parts = ip.split('.').map(Number);
	return Buffer.from(parts);
}

function encodeIpv6(ip: string): Buffer {
	const expanded = ip.replace('::', ':'.repeat(9 - ip.split(':').length) + ':');
	const groups = expanded.split(':');
	const buffer = Buffer.alloc(16);
	for (let groupIndex = 0; groupIndex < 8; groupIndex++) {
		buffer.writeUInt16BE(parseInt(groups[groupIndex]!, 16), groupIndex * 2);
	}
	return buffer;
}

function encodeMx(priority: number, exchange: string): Buffer {
	const priorityBuf = Buffer.alloc(2);
	priorityBuf.writeUInt16BE(priority, 0);
	return Buffer.concat([priorityBuf, encodeDomainName(exchange)]);
}

interface SoaTimingParams {
	serial: number;
	refresh: number;
	retry: number;
	expire: number;
	minimum: number;
}

function encodeSoa(mname: string, rname: string, timing: SoaTimingParams): Buffer {
	const params = Buffer.alloc(20);
	params.writeUInt32BE(timing.serial, 0);
	params.writeUInt32BE(timing.refresh, 4);
	params.writeUInt32BE(timing.retry, 8);
	params.writeUInt32BE(timing.expire, 12);
	params.writeUInt32BE(timing.minimum, 16);
	return Buffer.concat([encodeDomainName(mname), encodeDomainName(rname), params]);
}

function encodeTxt(text: string): Buffer {
	const chunks: Buffer[] = [];
	for (let offset = 0; offset < text.length; offset += 255) {
		const chunk = text.slice(offset, offset + 255);
		chunks.push(Buffer.from([chunk.length]), Buffer.from(chunk, 'ascii'));
	}
	return Buffer.concat(chunks);
}

function encodeSrv(priority: number, weight: number, port: number, target: string): Buffer {
	const header = Buffer.alloc(6);
	header.writeUInt16BE(priority, 0);
	header.writeUInt16BE(weight, 2);
	header.writeUInt16BE(port, 4);
	return Buffer.concat([header, encodeDomainName(target)]);
}

function encodeCaa(flags: number, tag: string, value: string): Buffer {
	return Buffer.concat([
		Buffer.from([flags, tag.length]),
		Buffer.from(tag, 'ascii'),
		Buffer.from(value, 'ascii'),
	]);
}

function buildZone(): ZoneMap {
	const zone: ZoneMap = new Map();

	function add(domain: string, type: number, rdata: Buffer) {
		const key = `${domain.toLowerCase()}:${type}`;
		const existing = zone.get(key) ?? [];
		existing.push({ type, rdata });
		zone.set(key, existing);
	}

	const typeValues = RECORD_TYPE_VALUES;

	// example.com records
	add('example.com', typeValues.A, encodeIpv4('93.184.216.34'));
	add('example.com', typeValues.AAAA, encodeIpv6('2606:2800:0220:0001:0248:1893:25c8:1946'));
	add('example.com', typeValues.MX, encodeMx(10, 'mail.example.com'));
	add('example.com', typeValues.TXT, encodeTxt('v=spf1 include:_spf.example.com -all'));
	add('example.com', typeValues.NS, encodeDomainName('ns1.example.com'));
	add('example.com', typeValues.NS, encodeDomainName('ns2.example.com'));
	add(
		'example.com',
		typeValues.SOA,
		encodeSoa('ns1.example.com', 'admin.example.com', {
			serial: 2024010101,
			refresh: 3600,
			retry: 900,
			expire: 604800,
			minimum: 86400,
		}),
	);
	add('example.com', typeValues.CAA, encodeCaa(0, 'issue', 'letsencrypt.org'));

	// github.com
	add('www.github.com', typeValues.CNAME, encodeDomainName('github.github.io'));

	// SRV
	add('_sip._tcp.example.com', typeValues.SRV, encodeSrv(10, 60, 5060, 'sip.example.com'));

	// PTR
	add('34.216.184.93.in-addr.arpa', typeValues.PTR, encodeDomainName('host.example.com'));

	// google.com records
	add('google.com', typeValues.TXT, encodeTxt('v=spf1 include:_spf.google.com ~all'));
	add(
		'_dmarc.google.com',
		typeValues.TXT,
		encodeTxt('v=DMARC1; p=reject; rua=mailto:mailauth-reports@google.com; pct=100'),
	);

	// gmail.com DKIM
	const dkimKey =
		'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2a2rwplBQLzHPtPDSEHbFljEgyMR' +
		'Jhu6OQMGCF' +
		'dtiGijLSig4CAzsYFncGJPI2jBJORSoXmqdCH85LUFbhMFir6dDkOTiVEZtz+F1RkPFQfFZT' +
		'qAdAR3vIqG' +
		'V4Z2JlVyjMr+cGSj9qH9AOzH50FJvRvnG6JK7xAIoR+VYq6K+VTVGiC5E6NhbN7Bc1rZLk' +
		'nahKIi4zh' +
		'lgrFLJbFn7Bz5VtgX0EYDhViUCksdN2VsPmRLBVZUvJOhxRGIVDZKhVbRYrIBl/hUc5vRDW' +
		'3IZOsmGCv' +
		'WNqS6dKqGHIGCkBIhd00dTLcEwl1KPJTjXqbNZJoLPKiOfz5fKQMBBaYQIDAQAB';
	add('20230601._domainkey.gmail.com', typeValues.TXT, encodeTxt(`v=DKIM1; k=rsa; p=${dkimKey}`));

	return zone;
}

// Known domains that exist in the zone (to distinguish NOERROR with no records from NXDOMAIN)
const KNOWN_DOMAINS = new Set([
	'example.com',
	'www.github.com',
	'github.com',
	'_sip._tcp.example.com',
	'_443._tcp.example.com',
	'34.216.184.93.in-addr.arpa',
	'google.com',
	'_dmarc.google.com',
	'gmail.com',
	'20230601._domainkey.gmail.com',
	'empty.example.com',
]);

// Domains that trigger specific DNS response codes instead of normal lookup
const FORCED_RESPONSE_CODES: Record<string, number> = {
	'servfail.test': 2,
	'refused.test': 5,
	'formerr.test': 1,
};

export class DnsTestServer {
	private socket: dgram.Socket | null = null;
	private zone: ZoneMap;
	private assignedPort = 0;

	constructor() {
		this.zone = buildZone();
	}

	async start(): Promise<DnsServer> {
		return new Promise((resolve, reject) => {
			this.socket = dgram.createSocket('udp4');

			this.socket.on('message', (message, remote) => {
				this.handleQuery(message, remote);
			});

			this.socket.on('error', reject);

			this.socket.bind(0, '127.0.0.1', () => {
				const address = this.socket!.address();
				this.assignedPort = address.port;
				resolve({ address: '127.0.0.1', port: this.assignedPort });
			});
		});
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this.socket) {
				this.socket.close(() => resolve());
				this.socket = null;
			} else {
				resolve();
			}
		});
	}

	private handleQuery(query: Buffer, remote: dgram.RemoteInfo) {
		if (query.length < HEADER_SIZE + 5) return;

		const { name, nextOffset } = parseQueryName(query, HEADER_SIZE);
		const questionEnd = nextOffset + 4; // type (2) + class (2)
		const lowerName = name.toLowerCase();

		const forcedCode = FORCED_RESPONSE_CODES[lowerName];
		if (forcedCode !== undefined) {
			const response = buildResponse(query, name, questionEnd, [], true);
			response.writeUInt16BE((response.readUInt16BE(2) & 0xfff0) | forcedCode, 2);
			this.socket?.send(response, remote.port, remote.address);
			return;
		}

		const queryType = query.readUInt16BE(nextOffset);
		const key = `${lowerName}:${queryType}`;
		const records = this.zone.get(key) ?? [];

		const domainExists = KNOWN_DOMAINS.has(lowerName);
		const effectiveRecords = domainExists ? records : [];
		const response = buildResponse(query, name, questionEnd, effectiveRecords, true);

		if (!domainExists && records.length === 0) {
			response.writeUInt16BE((response.readUInt16BE(2) & 0xfff0) | 3, 2); // NXDOMAIN
		}

		this.socket?.send(response, remote.port, remote.address);
	}
}
