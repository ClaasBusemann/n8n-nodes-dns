import { parseRdata } from '../../src/utils/record-parsers';
import type { DnsResourceRecord } from '../../src/transport/dns-packet';
import { RECORD_TYPE_VALUES } from '../../src/transport/dns-packet';
import { buildPacket } from '../helpers/build-packet';
function createResourceRecord(options: {
	recordType: number;
	rdata: Buffer;
	rdataOffset: number;
}): DnsResourceRecord {
	return {
		name: 'example.com',
		recordType: options.recordType,
		recordClass: 1,
		ttl: 300,
		rdataLength: options.rdata.length,
		rdata: options.rdata,
		rdataOffset: options.rdataOffset,
	};
}

describe('parseRdata', () => {
	describe('A records', () => {
		it('should parse a standard IPv4 address', () => {
			const rdata = Buffer.from([93, 184, 216, 34]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.A,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('93.184.216.34');
		});

		it('should parse all-zeros address', () => {
			const rdata = Buffer.from([0, 0, 0, 0]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.A,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('0.0.0.0');
		});

		it('should parse all-255s address', () => {
			const rdata = Buffer.from([255, 255, 255, 255]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.A,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('255.255.255.255');
		});

		it('should return parse error for truncated A record', () => {
			const rdata = Buffer.from([93, 184]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.A,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('AAAA records', () => {
		it('should parse a standard IPv6 address', () => {
			const rdata = Buffer.from([
				0x26, 0x06, 0x28, 0x00, 0x02, 0x20, 0x00, 0x01, 0x02, 0x48, 0x18, 0x93, 0x25, 0xc8, 0x19,
				0x46,
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.AAAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('2606:2800:220:1:248:1893:25c8:1946');
		});

		it('should format loopback as ::1', () => {
			const rdata = Buffer.alloc(16);
			rdata[15] = 1;
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.AAAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('::1');
		});

		it('should format all-zeros as ::', () => {
			const rdata = Buffer.alloc(16);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.AAAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('::');
		});

		it('should compress the longest zero run', () => {
			// 2001:db8:0:0:0:0:2:1 → 2001:db8::2:1
			const rdata = Buffer.from([
				0x20, 0x01, 0x0d, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00,
				0x01,
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.AAAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('2001:db8::2:1');
		});

		it('should compress the first run when two runs have equal length', () => {
			// 2001:0:0:1:0:0:2:3 → 2001::1:0:0:2:3 (first run of 2 wins over second run of 2)
			const rdata = Buffer.from([
				0x20, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00,
				0x03,
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.AAAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('2001::1:0:0:2:3');
		});

		it('should not compress a single zero group', () => {
			// fe80:0:1:2:3:4:5:6 → fe80:0:1:2:3:4:5:6 (no :: for run of 1)
			const rdata = Buffer.from([
				0xfe, 0x80, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00, 0x05, 0x00,
				0x06,
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.AAAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('fe80:0:1:2:3:4:5:6');
		});

		it('should return parse error for truncated AAAA record', () => {
			const rdata = Buffer.from([0x20, 0x01, 0x0d, 0xb8, 0x00, 0x00, 0x00, 0x00]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.AAAA,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('NS records', () => {
		it('should parse an uncompressed nameserver name', () => {
			// packet: "ns1.example.com" encoded at offset 0
			const packet = buildPacket(3, 'ns1', 7, 'example', 3, 'com', 0);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.NS,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toBe('ns1.example.com');
		});

		it('should parse a compressed nameserver name', () => {
			// offset 0: "example.com" (13 bytes), offset 13: "ns1" + pointer to 0
			const packet = buildPacket(7, 'example', 3, 'com', 0, 3, 'ns1', 0xc0, 0x00);
			const rdataOffset = 13;
			const rdata = Buffer.from(packet.subarray(rdataOffset));
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.NS,
				rdata,
				rdataOffset,
			});
			expect(parseRdata(record, packet)).toBe('ns1.example.com');
		});

		it('should return parse error for empty NS RDATA', () => {
			const packet = Buffer.alloc(0);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.NS,
				rdata: packet,
				rdataOffset: 0,
			});
			const result = parseRdata(record, packet);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('CNAME records', () => {
		it('should parse a CNAME domain name', () => {
			const packet = buildPacket(5, 'alias', 7, 'example', 3, 'com', 0);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.CNAME,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toBe('alias.example.com');
		});
	});

	describe('PTR records', () => {
		it('should parse a PTR domain name', () => {
			const packet = buildPacket(4, 'host', 7, 'example', 3, 'com', 0);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.PTR,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toBe('host.example.com');
		});
	});

	describe('MX records', () => {
		it('should parse priority and exchange name', () => {
			// 2-byte preference (10) + "mail.example.com"
			const packet = buildPacket(0x00, 0x0a, 4, 'mail', 7, 'example', 3, 'com', 0);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.MX,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toEqual({
				priority: 10,
				exchange: 'mail.example.com',
			});
		});

		it('should parse MX with compressed exchange name', () => {
			// offset 0: "example.com" (13 bytes)
			// offset 13: MX RDATA: preference=20, "mail" + pointer to 0
			const packet = buildPacket(7, 'example', 3, 'com', 0, 0x00, 0x14, 4, 'mail', 0xc0, 0x00);
			const rdataOffset = 13;
			const rdata = Buffer.from(packet.subarray(rdataOffset));
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.MX,
				rdata,
				rdataOffset,
			});
			expect(parseRdata(record, packet)).toEqual({
				priority: 20,
				exchange: 'mail.example.com',
			});
		});

		it('should return parse error for truncated MX record', () => {
			const rdata = Buffer.from([0x00]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.MX,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('SRV records', () => {
		it('should parse all four fields', () => {
			// priority=10, weight=60, port=5060, target="sip.example.com"
			const packet = buildPacket(
				0x00,
				0x0a,
				0x00,
				0x3c,
				0x13,
				0xc4,
				3,
				'sip',
				7,
				'example',
				3,
				'com',
				0,
			);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.SRV,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toEqual({
				priority: 10,
				weight: 60,
				port: 5060,
				target: 'sip.example.com',
			});
		});

		it('should parse SRV with boundary values', () => {
			// priority=0, weight=65535, port=0, target="a.b"
			const packet = buildPacket(0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 1, 'a', 1, 'b', 0);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.SRV,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toEqual({
				priority: 0,
				weight: 65535,
				port: 0,
				target: 'a.b',
			});
		});

		it('should return parse error for truncated SRV record', () => {
			const rdata = Buffer.from([0x00, 0x0a, 0x00, 0x3c]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.SRV,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('SOA records', () => {
		it('should parse all seven fields', () => {
			// mname="ns1.example.com", rname="admin.example.com", then 5 x uint32
			const mname = buildPacket(3, 'ns1', 7, 'example', 3, 'com', 0);
			const rname = buildPacket(5, 'admin', 7, 'example', 3, 'com', 0);
			const integers = Buffer.alloc(20);
			integers.writeUInt32BE(2024010101, 0); // serial
			integers.writeUInt32BE(3600, 4); // refresh
			integers.writeUInt32BE(900, 8); // retry
			integers.writeUInt32BE(604800, 12); // expire
			integers.writeUInt32BE(86400, 16); // minimum
			const packet = Buffer.concat([mname, rname, integers]);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.SOA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toEqual({
				mname: 'ns1.example.com',
				rname: 'admin.example.com',
				serial: 2024010101,
				refresh: 3600,
				retry: 900,
				expire: 604800,
				minimum: 86400,
			});
		});

		it('should parse SOA with compressed names', () => {
			// offset 0: "example.com" (13 bytes)
			// offset 13: SOA RDATA: "ns1"+ptr(0), "admin"+ptr(0), then integers
			const integers = Buffer.alloc(20);
			integers.writeUInt32BE(1, 0);
			integers.writeUInt32BE(2, 4);
			integers.writeUInt32BE(3, 8);
			integers.writeUInt32BE(4, 12);
			integers.writeUInt32BE(5, 16);
			const packet = Buffer.concat([
				buildPacket(7, 'example', 3, 'com', 0), // offset 0-12
				buildPacket(3, 'ns1', 0xc0, 0x00), // offset 13-18 (mname)
				buildPacket(5, 'admin', 0xc0, 0x00), // offset 19-26 (rname)
				integers, // offset 27-46
			]);
			const rdataOffset = 13;
			const rdata = Buffer.from(packet.subarray(rdataOffset));
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.SOA,
				rdata,
				rdataOffset,
			});
			expect(parseRdata(record, packet)).toEqual({
				mname: 'ns1.example.com',
				rname: 'admin.example.com',
				serial: 1,
				refresh: 2,
				retry: 3,
				expire: 4,
				minimum: 5,
			});
		});

		it('should return parse error for SOA with truncated integers', () => {
			// Two valid names but only 10 bytes of integers instead of 20
			const packet = Buffer.concat([
				buildPacket(2, 'ns', 0),
				buildPacket(2, 'rn', 0),
				Buffer.alloc(10),
			]);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.SOA,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, packet);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('NAPTR records', () => {
		it('should parse all six fields', () => {
			// order=10, preference=100, flags="s", service="SIP+D2U", regexp="", replacement="sip.example.com"
			const fixedFields = Buffer.alloc(4);
			fixedFields.writeUInt16BE(10, 0);
			fixedFields.writeUInt16BE(100, 2);
			const flagsField = buildPacket(1, 's'); // len=1, "s"
			const serviceField = buildPacket(7, 'SIP+D2U'); // len=7, "SIP+D2U"
			const regexpField = buildPacket(0); // len=0, empty
			const replacementField = buildPacket(3, 'sip', 7, 'example', 3, 'com', 0);
			const packet = Buffer.concat([
				fixedFields,
				flagsField,
				serviceField,
				regexpField,
				replacementField,
			]);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.NAPTR,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toEqual({
				order: 10,
				preference: 100,
				flags: 's',
				service: 'SIP+D2U',
				regexp: '',
				replacement: 'sip.example.com',
			});
		});

		it('should parse NAPTR with non-empty regexp', () => {
			const fixedFields = Buffer.alloc(4);
			fixedFields.writeUInt16BE(100, 0);
			fixedFields.writeUInt16BE(50, 2);
			const flagsField = buildPacket(1, 'u');
			const serviceField = buildPacket(7, 'E2U+sip');
			const regexpField = buildPacket(14, '!^.*$!sip:a@b!');
			const replacementField = buildPacket(0); // root domain
			const packet = Buffer.concat([
				fixedFields,
				flagsField,
				serviceField,
				regexpField,
				replacementField,
			]);
			const rdata = Buffer.from(packet);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.NAPTR,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, packet)).toEqual({
				order: 100,
				preference: 50,
				flags: 'u',
				service: 'E2U+sip',
				regexp: '!^.*$!sip:a@b!',
				replacement: '',
			});
		});

		it('should return parse error for truncated NAPTR record', () => {
			const rdata = Buffer.from([0x00, 0x0a, 0x00]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.NAPTR,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('TXT records', () => {
		it('should parse a single character string', () => {
			const text = 'v=spf1 include:example.com -all';
			const rdata = buildPacket(text.length, text);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TXT,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({
				raw: text,
				parsed: {
					type: 'spf',
					version: 'spf1',
					mechanisms: [
						{ qualifier: '+', type: 'include', value: 'example.com' },
						{ qualifier: '-', type: 'all', value: null },
					],
				},
			});
		});

		it('should concatenate multiple character strings', () => {
			const part1 = 'Hello ';
			const part2 = 'World';
			const rdata = buildPacket(part1.length, part1, part2.length, part2);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TXT,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({ raw: 'Hello World', parsed: null });
		});

		it('should handle an empty TXT record', () => {
			const rdata = buildPacket(0); // single zero-length string
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TXT,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({ raw: '', parsed: null });
		});

		it('should handle a 255-byte character string', () => {
			const longText = 'a'.repeat(255);
			const rdata = buildPacket(255, longText);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TXT,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({ raw: longText, parsed: null });
		});

		it('should return parse error when length exceeds buffer', () => {
			// Length byte says 10 but only 5 bytes follow
			const rdata = Buffer.from([10, 0x41, 0x42, 0x43, 0x44, 0x45]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TXT,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('CAA records', () => {
		it('should parse flags, tag, and value', () => {
			// flags=0, tagLen=5, tag="issue", value="letsencrypt.org"
			const rdata = buildPacket(0x00, 5, 'issue', 'letsencrypt.org');
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.CAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({
				flags: 0,
				tag: 'issue',
				value: 'letsencrypt.org',
			});
		});

		it('should parse CAA with issuer critical flag', () => {
			const rdata = buildPacket(0x80, 9, 'issuewild', ';');
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.CAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({
				flags: 128,
				tag: 'issuewild',
				value: ';',
			});
		});

		it('should parse CAA with iodef tag', () => {
			const rdata = buildPacket(0x00, 5, 'iodef', 'mailto:security@example.com');
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.CAA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({
				flags: 0,
				tag: 'iodef',
				value: 'mailto:security@example.com',
			});
		});

		it('should return parse error for truncated CAA record', () => {
			const rdata = Buffer.from([0x00]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.CAA,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('DNSKEY records', () => {
		it('should parse a zone signing key', () => {
			const keyBytes = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
			const rdata = Buffer.concat([
				Buffer.from([0x01, 0x00, 0x03, 0x0d]), // flags=256, protocol=3, algorithm=13
				keyBytes,
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.DNSKEY,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({
				flags: 256,
				protocol: 3,
				algorithm: 13,
				publicKey: keyBytes.toString('base64'),
			});
		});

		it('should parse a key signing key', () => {
			const keyBytes = Buffer.from([0x01, 0x02, 0x03]);
			const rdata = Buffer.concat([
				Buffer.from([0x01, 0x01, 0x03, 0x08]), // flags=257, protocol=3, algorithm=8
				keyBytes,
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.DNSKEY,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({
				flags: 257,
				protocol: 3,
				algorithm: 8,
				publicKey: keyBytes.toString('base64'),
			});
		});

		it('should return parse error for truncated DNSKEY record', () => {
			const rdata = Buffer.from([0x01, 0x00, 0x03]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.DNSKEY,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('TLSA records', () => {
		it('should parse DANE-EE with SHA-256', () => {
			const certHash = Buffer.from('e3b0c44298fc1c149afbf4c8996fb924', 'hex');
			const rdata = Buffer.concat([
				Buffer.from([0x03, 0x01, 0x01]), // usage=3, selector=1, matchingType=1
				certHash,
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TLSA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({
				usage: 3,
				selector: 1,
				matchingType: 1,
				certificateData: certHash.toString('hex'),
			});
		});

		it('should parse full certificate TLSA', () => {
			const certBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
			const rdata = Buffer.concat([
				Buffer.from([0x00, 0x00, 0x00]), // usage=0, selector=0, matchingType=0
				certBytes,
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TLSA,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toEqual({
				usage: 0,
				selector: 0,
				matchingType: 0,
				certificateData: 'deadbeef',
			});
		});

		it('should return parse error for truncated TLSA record', () => {
			const rdata = Buffer.from([0x03, 0x01]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TLSA,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});
	});

	describe('unknown record types', () => {
		it('should return hex string for unknown record type', () => {
			const rdata = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
			const record = createResourceRecord({
				recordType: 999,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('deadbeef');
		});

		it('should return empty string for unknown type with empty RDATA', () => {
			const rdata = Buffer.alloc(0);
			const record = createResourceRecord({
				recordType: 999,
				rdata,
				rdataOffset: 0,
			});
			expect(parseRdata(record, rdata)).toBe('');
		});
	});

	describe('malformed RDATA', () => {
		it('should handle A record with zero bytes gracefully', () => {
			const rdata = Buffer.alloc(0);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.A,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});

		it('should handle MX record with only one byte gracefully', () => {
			const rdata = Buffer.from([0x00]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.MX,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});

		it('should handle SOA with truncated integers gracefully', () => {
			const packet = Buffer.concat([
				buildPacket(2, 'ns', 0),
				buildPacket(2, 'rn', 0),
				Buffer.alloc(10),
			]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.SOA,
				rdata: Buffer.from(packet),
				rdataOffset: 0,
			});
			const result = parseRdata(record, packet);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});

		it('should handle TXT with length exceeding buffer gracefully', () => {
			const rdata = Buffer.from([50, 0x41, 0x42, 0x43]);
			const record = createResourceRecord({
				recordType: RECORD_TYPE_VALUES.TXT,
				rdata,
				rdataOffset: 0,
			});
			const result = parseRdata(record, rdata);
			expect(typeof result).toBe('string');
			expect(result).toContain('Parse error');
		});

		it('should never throw from parseRdata regardless of input', () => {
			const recordTypes = [
				RECORD_TYPE_VALUES.A,
				RECORD_TYPE_VALUES.AAAA,
				RECORD_TYPE_VALUES.NS,
				RECORD_TYPE_VALUES.MX,
				RECORD_TYPE_VALUES.TXT,
				RECORD_TYPE_VALUES.SRV,
				RECORD_TYPE_VALUES.SOA,
				RECORD_TYPE_VALUES.CAA,
				RECORD_TYPE_VALUES.NAPTR,
				RECORD_TYPE_VALUES.DNSKEY,
				RECORD_TYPE_VALUES.TLSA,
			];
			for (const recordType of recordTypes) {
				const rdata = Buffer.alloc(0);
				const record = createResourceRecord({
					recordType,
					rdata,
					rdataOffset: 0,
				});
				expect(() => parseRdata(record, rdata)).not.toThrow();
			}
		});
	});
});
