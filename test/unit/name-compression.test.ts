import { decompressName } from '../../src/utils/name-compression';
import { buildPacket } from '../helpers/build-packet';

describe('decompressName', () => {
	describe('plain label encoding', () => {
		it('should decompress a single-label name', () => {
			const packet = buildPacket(3, 'com', 0);
			expect(decompressName(packet, 0)).toEqual({
				name: 'com',
				bytesConsumed: 5,
			});
		});

		it('should decompress a two-label name', () => {
			const packet = buildPacket(7, 'example', 3, 'com', 0);
			expect(decompressName(packet, 0)).toEqual({
				name: 'example.com',
				bytesConsumed: 13,
			});
		});

		it('should decompress a three-label name', () => {
			const packet = buildPacket(3, 'www', 7, 'example', 3, 'com', 0);
			expect(decompressName(packet, 0)).toEqual({
				name: 'www.example.com',
				bytesConsumed: 17,
			});
		});

		it('should decompress a name at a non-zero offset', () => {
			const header = new Array(12).fill(0) as number[];
			const packet = buildPacket(...header, 7, 'example', 3, 'com', 0);
			expect(decompressName(packet, 12)).toEqual({
				name: 'example.com',
				bytesConsumed: 13,
			});
		});

		it('should handle the root name', () => {
			const packet = buildPacket(0);
			expect(decompressName(packet, 0)).toEqual({
				name: '',
				bytesConsumed: 1,
			});
		});
	});

	describe('compression pointers', () => {
		it('should follow a simple pointer', () => {
			// offset 0: "example.com" (13 bytes), offset 13: pointer to 0
			const packet = buildPacket(7, 'example', 3, 'com', 0, 0xc0, 0x00);
			expect(decompressName(packet, 13)).toEqual({
				name: 'example.com',
				bytesConsumed: 2,
			});
		});

		it('should follow a pointer at a typical response offset', () => {
			// 12-byte header, then "example.com" at offset 12, then pointer at offset 25
			const header = new Array(12).fill(0) as number[];
			const packet = buildPacket(...header, 7, 'example', 3, 'com', 0, 0xc0, 0x0c);
			expect(decompressName(packet, 25)).toEqual({
				name: 'example.com',
				bytesConsumed: 2,
			});
		});

		it('should decompress a label followed by a pointer', () => {
			// offset 0: 12-byte header
			// offset 12: "example.com" (13 bytes)
			// offset 25: "www" + pointer to offset 12
			const header = new Array(12).fill(0) as number[];
			const packet = buildPacket(...header, 7, 'example', 3, 'com', 0, 3, 'www', 0xc0, 0x0c);
			expect(decompressName(packet, 25)).toEqual({
				name: 'www.example.com',
				bytesConsumed: 6,
			});
		});

		it('should follow a pointer to the middle of a name', () => {
			// offset 0: "example.com" where "com" starts at offset 8
			// offset 13: pointer to offset 8
			const packet = buildPacket(7, 'example', 3, 'com', 0, 0xc0, 0x08);
			expect(decompressName(packet, 13)).toEqual({
				name: 'com',
				bytesConsumed: 2,
			});
		});
	});

	describe('chained pointers', () => {
		it('should follow a chain of pointers through multiple names', () => {
			// offset 0: "com\0" (5 bytes)
			// offset 5: "example" + pointer to 0 (10 bytes)
			// offset 15: "www" + pointer to 5 (6 bytes)
			const packet = buildPacket(3, 'com', 0, 7, 'example', 0xc0, 0x00, 3, 'www', 0xc0, 0x05);
			expect(decompressName(packet, 15)).toEqual({
				name: 'www.example.com',
				bytesConsumed: 6,
			});
		});

		it('should follow a pointer that targets another pointer', () => {
			// offset 0: "example.com" (13 bytes)
			// offset 13: pointer to offset 0 (2 bytes)
			// offset 15: pointer to offset 13 (2 bytes)
			const packet = buildPacket(7, 'example', 3, 'com', 0, 0xc0, 0x00, 0xc0, 0x0d);
			expect(decompressName(packet, 15)).toEqual({
				name: 'example.com',
				bytesConsumed: 2,
			});
		});
	});

	describe('pointer loop detection', () => {
		it('should reject a self-referencing pointer', () => {
			const packet = buildPacket(0xc0, 0x00);
			expect(() => decompressName(packet, 0)).toThrow(/exceeded maximum pointer depth/);
		});

		it('should reject a mutual pointer loop', () => {
			// offset 0: pointer to offset 2
			// offset 2: pointer to offset 0
			const packet = buildPacket(0xc0, 0x02, 0xc0, 0x00);
			expect(() => decompressName(packet, 0)).toThrow(/exceeded maximum pointer depth/);
		});

		it('should reject a chain exceeding the depth limit of 10', () => {
			// 11 consecutive pointers: offset 0->2, 2->4, ..., 18->20, 20->0 (loop)
			const bytes: number[] = [];
			for (let pointerIndex = 0; pointerIndex < 11; pointerIndex++) {
				const targetOffset = ((pointerIndex + 1) % 11) * 2;
				bytes.push(0xc0, targetOffset);
			}
			const packet = Buffer.from(bytes);
			expect(() => decompressName(packet, 0)).toThrow(/exceeded maximum pointer depth/);
		});

		it('should accept a chain of exactly 10 pointers', () => {
			// 10 pointers chained, last one points to a valid name
			// offset 0->2, 2->4, ..., 16->18, then offset 18: pointer to offset 20
			// offset 20: "com\0"
			const bytes: number[] = [];
			for (let pointerIndex = 0; pointerIndex < 10; pointerIndex++) {
				const targetOffset = (pointerIndex + 1) * 2;
				bytes.push(0xc0, targetOffset);
			}
			// offset 20: "com\0"
			bytes.push(3, 0x63, 0x6f, 0x6d, 0);
			const packet = Buffer.from(bytes);
			expect(decompressName(packet, 0)).toEqual({
				name: 'com',
				bytesConsumed: 2,
			});
		});
	});

	describe('boundary and error conditions', () => {
		it('should reject a name exceeding 253 characters', () => {
			// Build a name with labels that total > 253 chars in dot notation
			// 32 labels of 8 chars each: 32*8 + 31 dots = 287 > 253
			const segments: (number | string)[] = [];
			for (let labelIndex = 0; labelIndex < 32; labelIndex++) {
				segments.push(8, 'abcdefgh');
			}
			segments.push(0);
			const packet = buildPacket(...segments);
			expect(() => decompressName(packet, 0)).toThrow(/exceeds maximum length/);
		});

		it('should reject a truncated label', () => {
			// Label says 7 bytes but only 2 follow
			const packet = buildPacket(7, 'ex');
			expect(() => decompressName(packet, 0)).toThrow(/end of packet/);
		});

		it('should reject a pointer beyond the packet boundary', () => {
			const packet = buildPacket(0xc0, 0xff);
			expect(() => decompressName(packet, 0)).toThrow(/beyond packet boundary/);
		});
	});
});
