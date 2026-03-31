import {
	encodeQuery,
	decodeResponse,
	encodeDomainName,
	RECORD_TYPE_VALUES,
	RECORD_TYPE_NAMES,
	RESPONSE_CODE_NAMES,
} from '../../src/transport/dns-packet';
import type { DnsRecordType } from '../../src/transport/dns-packet';
import { buildPacket } from '../helpers/build-packet';

describe('dns-packet', () => {
	describe('RECORD_TYPE_VALUES', () => {
		it('should map all 13 supported record types to their RFC numeric values', () => {
			expect(RECORD_TYPE_VALUES).toEqual({
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
			});
		});

		it('should have exactly 13 entries', () => {
			expect(Object.keys(RECORD_TYPE_VALUES)).toHaveLength(13);
		});
	});

	describe('RECORD_TYPE_NAMES', () => {
		it('should produce a reverse map from numeric values to type names', () => {
			for (const [name, value] of Object.entries(RECORD_TYPE_VALUES)) {
				expect(RECORD_TYPE_NAMES[value]).toBe(name);
			}
		});
	});

	describe('RESPONSE_CODE_NAMES', () => {
		it('should map standard DNS response codes', () => {
			expect(RESPONSE_CODE_NAMES[0]).toBe('NOERROR');
			expect(RESPONSE_CODE_NAMES[1]).toBe('FORMERR');
			expect(RESPONSE_CODE_NAMES[2]).toBe('SERVFAIL');
			expect(RESPONSE_CODE_NAMES[3]).toBe('NXDOMAIN');
			expect(RESPONSE_CODE_NAMES[4]).toBe('NOTIMP');
			expect(RESPONSE_CODE_NAMES[5]).toBe('REFUSED');
		});
	});

	describe('encodeDomainName', () => {
		it('should encode a two-label domain name', () => {
			const result = encodeDomainName('example.com');
			const expected = buildPacket(7, 'example', 3, 'com', 0);
			expect(result).toEqual(expected);
		});

		it('should encode a three-label domain name', () => {
			const result = encodeDomainName('www.example.com');
			const expected = buildPacket(3, 'www', 7, 'example', 3, 'com', 0);
			expect(result).toEqual(expected);
		});

		it('should encode a single-label domain name', () => {
			const result = encodeDomainName('localhost');
			const expected = buildPacket(9, 'localhost', 0);
			expect(result).toEqual(expected);
		});

		it('should encode the root domain as a single zero byte', () => {
			const result = encodeDomainName('');
			expect(result).toEqual(Buffer.from([0x00]));
		});

		it('should encode a maximum-length label of exactly 63 bytes', () => {
			const maxLabel = 'a'.repeat(63);
			const result = encodeDomainName(maxLabel);
			expect(result[0]).toBe(63);
			expect(result.toString('ascii', 1, 64)).toBe(maxLabel);
			expect(result[64]).toBe(0);
		});

		it('should encode a domain name at exactly 253 characters', () => {
			// 253 chars: 63.63.63.61 = 63+1+63+1+63+1+61 = 253
			const labels = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)];
			const domain = labels.join('.');
			expect(domain.length).toBe(253);
			const result = encodeDomainName(domain);
			expect(result[0]).toBe(63);
			expect(result[result.length - 1]).toBe(0);
		});

		it('should reject a label exceeding 63 bytes', () => {
			const longLabel = 'a'.repeat(64);
			expect(() => encodeDomainName(longLabel)).toThrow(/exceeds maximum of 63/);
		});

		it('should reject a domain name exceeding 253 characters', () => {
			const labels = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(62)];
			const domain = labels.join('.');
			expect(domain.length).toBe(254);
			expect(() => encodeDomainName(domain)).toThrow(/exceeds maximum length/);
		});

		it('should reject empty labels from consecutive dots', () => {
			expect(() => encodeDomainName('example..com')).toThrow(/empty label/);
		});

		it('should reject a trailing dot producing an empty label', () => {
			expect(() => encodeDomainName('example.com.')).toThrow(/empty label/);
		});
	});

	describe('encodeQuery', () => {
		it('should produce a packet starting with a 12-byte header', () => {
			const packet = encodeQuery('example.com', 'A');
			expect(packet.length).toBeGreaterThanOrEqual(12);
		});

		it('should generate a 2-byte transaction ID in the first two bytes', () => {
			const packet = encodeQuery('example.com', 'A');
			const transactionId = packet.readUInt16BE(0);
			expect(transactionId).toBeGreaterThanOrEqual(0);
			expect(transactionId).toBeLessThanOrEqual(0xffff);
		});

		it('should generate different transaction IDs on successive calls', () => {
			const ids = new Set<number>();
			for (let callIndex = 0; callIndex < 20; callIndex++) {
				const packet = encodeQuery('example.com', 'A');
				ids.add(packet.readUInt16BE(0));
			}
			expect(ids.size).toBeGreaterThan(1);
		});

		it('should set the RD flag when recursionDesired is true', () => {
			const packet = encodeQuery('example.com', 'A', { recursionDesired: true });
			const flags = packet.readUInt16BE(2);
			expect(flags & 0x0100).toBe(0x0100);
		});

		it('should clear the RD flag when recursionDesired is false', () => {
			const packet = encodeQuery('example.com', 'A', { recursionDesired: false });
			const flags = packet.readUInt16BE(2);
			expect(flags & 0x0100).toBe(0);
		});

		it('should default recursionDesired to true when flags are omitted', () => {
			const packet = encodeQuery('example.com', 'A');
			const flags = packet.readUInt16BE(2);
			expect(flags & 0x0100).toBe(0x0100);
		});

		it('should set QDCOUNT to 1', () => {
			const packet = encodeQuery('example.com', 'A');
			expect(packet.readUInt16BE(4)).toBe(1);
		});

		it('should set ANCOUNT, NSCOUNT, and ARCOUNT to 0', () => {
			const packet = encodeQuery('example.com', 'A');
			expect(packet.readUInt16BE(6)).toBe(0);
			expect(packet.readUInt16BE(8)).toBe(0);
			expect(packet.readUInt16BE(10)).toBe(0);
		});

		it('should set QR bit to 0 (query)', () => {
			const packet = encodeQuery('example.com', 'A');
			const flags = packet.readUInt16BE(2);
			expect(flags & 0x8000).toBe(0);
		});

		it('should set QCLASS to IN (1)', () => {
			const packet = encodeQuery('example.com', 'A');
			const qclassOffset = packet.length - 2;
			expect(packet.readUInt16BE(qclassOffset)).toBe(1);
		});

		it('should encode the domain name in the question section', () => {
			const packet = encodeQuery('example.com', 'A');
			const questionStart = 12;
			const expectedName = encodeDomainName('example.com');
			const actualName = packet.subarray(questionStart, questionStart + expectedName.length);
			expect(actualName).toEqual(expectedName);
		});

		describe('record type encoding', () => {
			const recordTypes: [DnsRecordType, number][] = [
				['A', 1],
				['NS', 2],
				['CNAME', 5],
				['SOA', 6],
				['PTR', 12],
				['MX', 15],
				['TXT', 16],
				['AAAA', 28],
				['SRV', 33],
				['NAPTR', 35],
				['DNSKEY', 48],
				['TLSA', 52],
				['CAA', 257],
			];

			for (const [typeName, typeValue] of recordTypes) {
				it(`should encode ${typeName} with QTYPE value ${typeValue}`, () => {
					const packet = encodeQuery('example.com', typeName);
					const qtypeOffset = packet.length - 4;
					expect(packet.readUInt16BE(qtypeOffset)).toBe(typeValue);
				});
			}
		});

		describe('reference packet comparison', () => {
			it('should match a reference query packet for example.com A (excluding transaction ID)', () => {
				const packet = encodeQuery('example.com', 'A', { recursionDesired: true });
				// Reference: abcd01000001000000000000076578616d706c6503636f6d0000010001
				const reference = Buffer.from(
					'abcd01000001000000000000076578616d706c6503636f6d0000010001',
					'hex',
				);
				// Compare everything except bytes 0-1 (transaction ID)
				expect(packet.subarray(2)).toEqual(reference.subarray(2));
			});
		});
	});

	describe('decodeResponse', () => {
		describe('header decoding', () => {
			it('should decode a standard response header', () => {
				const packet = Buffer.from(
					'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.header.transactionId).toBe(0xabcd);
				expect(response.header.questionCount).toBe(1);
				expect(response.header.answerCount).toBe(1);
				expect(response.header.authorityCount).toBe(0);
				expect(response.header.additionalCount).toBe(0);
			});

			it('should extract all flag fields correctly', () => {
				// Flags 0x8180: QR=1, Opcode=0, AA=0, TC=0, RD=1, RA=1, RCODE=0
				const packet = Buffer.from(
					'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822',
					'hex',
				);
				const { flags } = decodeResponse(packet).header;
				expect(flags.queryResponse).toBe(true);
				expect(flags.opcode).toBe(0);
				expect(flags.authoritative).toBe(false);
				expect(flags.truncated).toBe(false);
				expect(flags.recursionDesired).toBe(true);
				expect(flags.recursionAvailable).toBe(true);
				expect(flags.responseCode).toBe(0);
			});

			it('should decode the authoritative flag', () => {
				// Flags 0x8580: QR=1, AA=1, RD=1, RA=1
				const packet = Buffer.from(
					'abcd85800001000000000000076578616d706c6503636f6d0000010001',
					'hex',
				);
				const { flags } = decodeResponse(packet).header;
				expect(flags.authoritative).toBe(true);
			});

			it('should decode the truncated flag', () => {
				// Flags 0x8380: QR=1, TC=1, RD=1, RA=1
				const packet = Buffer.from(
					'abcd83800001000000000000076578616d706c6503636f6d0000010001',
					'hex',
				);
				const { flags } = decodeResponse(packet).header;
				expect(flags.truncated).toBe(true);
			});

			it('should decode NXDOMAIN response code', () => {
				const packet = Buffer.from(
					'567881830001000000000000076578616d706c6503636f6d0000010001',
					'hex',
				);
				const { flags } = decodeResponse(packet).header;
				expect(flags.responseCode).toBe(3);
			});

			it('should decode SERVFAIL response code', () => {
				// Flags 0x8182: QR=1, RD=1, RA=1, RCODE=2
				const packet = Buffer.from(
					'abcd81820001000000000000076578616d706c6503636f6d0000010001',
					'hex',
				);
				const { flags } = decodeResponse(packet).header;
				expect(flags.responseCode).toBe(2);
			});

			it('should reject a packet shorter than 12 bytes', () => {
				const packet = Buffer.from('abcd8180', 'hex');
				expect(() => decodeResponse(packet)).toThrow(/too short/);
			});
		});

		describe('question section', () => {
			it('should decode a single question entry', () => {
				const packet = Buffer.from(
					'abcd81800001000000000000076578616d706c6503636f6d0000010001',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.questions).toHaveLength(1);
				expect(response.questions[0]).toEqual({
					name: 'example.com',
					recordType: 1,
					recordClass: 1,
				});
			});

			it('should decode the record type for an MX query', () => {
				const packet = Buffer.from(
					'abcd81800001000000000000076578616d706c6503636f6d00000f0001',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.questions[0]!.recordType).toBe(15);
			});
		});

		describe('answer section', () => {
			it('should decode a single A record answer', () => {
				const packet = Buffer.from(
					'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.answers).toHaveLength(1);
				const answer = response.answers[0]!;
				expect(answer.name).toBe('example.com');
				expect(answer.recordType).toBe(1);
				expect(answer.recordClass).toBe(1);
				expect(answer.ttl).toBe(3600);
				expect(answer.rdataLength).toBe(4);
				expect(answer.rdata).toEqual(Buffer.from([93, 184, 216, 34]));
			});

			it('should decode multiple answer records', () => {
				const packet = Buffer.from(
					'123481800001000200000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822c00c0001000100000e1000045db8d823',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.answers).toHaveLength(2);
				expect(response.answers[0]!.rdata).toEqual(Buffer.from([93, 184, 216, 34]));
				expect(response.answers[1]!.rdata).toEqual(Buffer.from([93, 184, 216, 35]));
			});

			it('should return raw RDATA as an independent Buffer copy', () => {
				const packet = Buffer.from(
					'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822',
					'hex',
				);
				const response = decodeResponse(packet);
				const rdata = response.answers[0]!.rdata;
				// Modifying the original packet should not affect the RDATA copy
				const originalByte = rdata[0];
				packet[packet.length - 4] = 0xff;
				expect(rdata[0]).toBe(originalByte);
			});

			it('should decode the TTL field correctly', () => {
				const packet = Buffer.from(
					'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001000100015180000400000000',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.answers[0]!.ttl).toBe(86400);
			});

			it('should record the rdataOffset in the resource record', () => {
				const packet = Buffer.from(
					'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822',
					'hex',
				);
				const response = decodeResponse(packet);
				const answer = response.answers[0]!;
				// Verify rdata at rdataOffset matches the rdata Buffer
				expect(
					packet.subarray(answer.rdataOffset, answer.rdataOffset + answer.rdataLength),
				).toEqual(answer.rdata);
			});
		});

		describe('authority and additional sections', () => {
			it('should decode authority and additional records', () => {
				const packet = Buffer.from(
					'9abc81800001000100010001076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822c00c00020001000151800006036e7331c00c036e7331c00c0001000100000e100004c6336401',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.answers).toHaveLength(1);
				expect(response.authorities).toHaveLength(1);
				expect(response.additionals).toHaveLength(1);

				const authority = response.authorities[0]!;
				expect(authority.name).toBe('example.com');
				expect(authority.recordType).toBe(2); // NS

				const additional = response.additionals[0]!;
				expect(additional.name).toBe('ns1.example.com');
				expect(additional.recordType).toBe(1); // A
				expect(additional.rdata).toEqual(Buffer.from([198, 51, 100, 1]));
			});

			it('should handle zero-count sections', () => {
				const packet = Buffer.from(
					'abcd81800001000000000000076578616d706c6503636f6d0000010001',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.answers).toHaveLength(0);
				expect(response.authorities).toHaveLength(0);
				expect(response.additionals).toHaveLength(0);
			});
		});

		describe('name compression in responses', () => {
			it('should follow compression pointers in answer names', () => {
				const packet = Buffer.from(
					'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822',
					'hex',
				);
				const response = decodeResponse(packet);
				// Answer name uses pointer 0xc00c → offset 12 → "example.com"
				expect(response.answers[0]!.name).toBe('example.com');
			});

			it('should handle compressed names referencing the question section', () => {
				// Authority section name points back to question name at offset 12
				const packet = Buffer.from(
					'9abc81800001000100010001076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822c00c00020001000151800006036e7331c00c036e7331c00c0001000100000e100004c6336401',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.authorities[0]!.name).toBe('example.com');
				expect(response.additionals[0]!.name).toBe('ns1.example.com');
			});
		});

		describe('reference response packets', () => {
			it('should decode a reference A record response for example.com', () => {
				const packet = Buffer.from(
					'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.header.transactionId).toBe(0xabcd);
				expect(response.header.flags.queryResponse).toBe(true);
				expect(response.header.flags.responseCode).toBe(0);
				expect(response.questions[0]!.name).toBe('example.com');
				expect(response.questions[0]!.recordType).toBe(1);
				expect(response.answers[0]!.name).toBe('example.com');
				expect(response.answers[0]!.rdata).toEqual(Buffer.from([93, 184, 216, 34]));
				expect(response.answers[0]!.ttl).toBe(3600);
			});

			it('should decode an NXDOMAIN response', () => {
				const packet = Buffer.from(
					'567881830001000000000000076578616d706c6503636f6d0000010001',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.header.flags.responseCode).toBe(3);
				expect(response.answers).toHaveLength(0);
				expect(response.questions[0]!.name).toBe('example.com');
			});

			it('should decode a response with multiple answers', () => {
				const packet = Buffer.from(
					'123481800001000200000000076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822c00c0001000100000e1000045db8d823',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.answers).toHaveLength(2);
				expect(response.answers[0]!.rdata).toEqual(Buffer.from([93, 184, 216, 34]));
				expect(response.answers[1]!.rdata).toEqual(Buffer.from([93, 184, 216, 35]));
			});

			it('should decode a response with authority and additional sections', () => {
				const packet = Buffer.from(
					'9abc81800001000100010001076578616d706c6503636f6d0000010001c00c0001000100000e1000045db8d822c00c00020001000151800006036e7331c00c036e7331c00c0001000100000e100004c6336401',
					'hex',
				);
				const response = decodeResponse(packet);
				expect(response.header.questionCount).toBe(1);
				expect(response.header.answerCount).toBe(1);
				expect(response.header.authorityCount).toBe(1);
				expect(response.header.additionalCount).toBe(1);
				expect(response.authorities[0]!.recordType).toBe(2); // NS
				expect(response.additionals[0]!.recordType).toBe(1); // A
				expect(response.additionals[0]!.rdata).toEqual(Buffer.from([198, 51, 100, 1]));
			});
		});
	});

	describe('round-trip encoding and decoding', () => {
		it('should round-trip a query through encode then decode', () => {
			const packet = encodeQuery('example.com', 'A', { recursionDesired: true });
			const response = decodeResponse(packet);
			expect(response.header.flags.queryResponse).toBe(false);
			expect(response.header.flags.recursionDesired).toBe(true);
			expect(response.header.questionCount).toBe(1);
			expect(response.header.answerCount).toBe(0);
			expect(response.questions[0]!.name).toBe('example.com');
			expect(response.questions[0]!.recordType).toBe(1);
			expect(response.questions[0]!.recordClass).toBe(1);
		});

		it('should preserve domain name through encode/decode cycle', () => {
			const packet = encodeQuery('sub.domain.example.com', 'AAAA');
			const response = decodeResponse(packet);
			expect(response.questions[0]!.name).toBe('sub.domain.example.com');
		});

		it('should preserve record type through encode/decode cycle', () => {
			const recordTypes: DnsRecordType[] = [
				'A',
				'NS',
				'CNAME',
				'SOA',
				'PTR',
				'MX',
				'TXT',
				'AAAA',
				'SRV',
				'NAPTR',
				'DNSKEY',
				'TLSA',
				'CAA',
			];
			for (const recordType of recordTypes) {
				const packet = encodeQuery('example.com', recordType);
				const response = decodeResponse(packet);
				expect(response.questions[0]!.recordType).toBe(RECORD_TYPE_VALUES[recordType]);
			}
		});
	});

	describe('edge cases', () => {
		it('should handle maximum-length labels (63 bytes) in encode/decode', () => {
			const maxLabel = 'a'.repeat(63);
			const domain = `${maxLabel}.com`;
			const packet = encodeQuery(domain, 'A');
			const response = decodeResponse(packet);
			expect(response.questions[0]!.name).toBe(domain);
		});

		it('should handle maximum-length domain names (253 chars) in encode/decode', () => {
			const domain = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
			expect(domain.length).toBe(253);
			const packet = encodeQuery(domain, 'A');
			const response = decodeResponse(packet);
			expect(response.questions[0]!.name).toBe(domain);
		});

		it('should decode a response with zero answers', () => {
			const packet = Buffer.from(
				'567881830001000000000000076578616d706c6503636f6d0000010001',
				'hex',
			);
			const response = decodeResponse(packet);
			expect(response.answers).toHaveLength(0);
		});

		it('should decode a response with an empty question section (QDCOUNT=0)', () => {
			// Header only, no question section, no answers
			const packet = Buffer.from('abcd818000000000000000000000', 'hex');
			// Trim to exactly 12 bytes
			const header = packet.subarray(0, 12);
			const response = decodeResponse(header);
			expect(response.questions).toHaveLength(0);
			expect(response.answers).toHaveLength(0);
		});

		it('should reject a truncated packet mid-resource-record', () => {
			// Header says 1 answer but packet ends after question
			const packet = Buffer.from(
				'abcd81800001000100000000076578616d706c6503636f6d0000010001c00c0001',
				'hex',
			);
			expect(() => decodeResponse(packet)).toThrow(/truncated/);
		});

		it('should reject a packet with RDATA extending beyond packet boundary', () => {
			// Valid header and question, answer claims 100 bytes of RDATA but packet is too short
			const header = Buffer.alloc(12);
			header.writeUInt16BE(0xabcd, 0);
			header.writeUInt16BE(0x8180, 2);
			header.writeUInt16BE(1, 4); // 1 question
			header.writeUInt16BE(1, 6); // 1 answer
			const questionName = Buffer.from('076578616d706c6503636f6d00', 'hex');
			const questionTypeClass = Buffer.from('00010001', 'hex');
			const answerName = Buffer.from('c00c', 'hex');
			const answerFields = Buffer.alloc(10);
			answerFields.writeUInt16BE(1, 0); // TYPE=A
			answerFields.writeUInt16BE(1, 2); // CLASS=IN
			answerFields.writeUInt32BE(3600, 4); // TTL
			answerFields.writeUInt16BE(100, 8); // RDLENGTH=100 (too long)
			const shortRdata = Buffer.from([1, 2, 3, 4]); // only 4 bytes
			const packet = Buffer.concat([
				header,
				questionName,
				questionTypeClass,
				answerName,
				answerFields,
				shortRdata,
			]);
			expect(() => decodeResponse(packet)).toThrow(/truncated.*RDATA/);
		});
	});
});
