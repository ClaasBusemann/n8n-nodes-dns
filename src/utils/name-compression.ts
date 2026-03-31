import { DNS_MAX_NAME_LENGTH } from './index';

const POINTER_MASK = 0xc0;
const POINTER_OFFSET_MASK = 0x3fff;
const MAX_POINTER_DEPTH = 10;
const MAX_LABEL_LENGTH = 63;

export interface DecompressedName {
	name: string;
	bytesConsumed: number;
}

function isPointerByte(byte: number): boolean {
	return (byte & POINTER_MASK) === POINTER_MASK;
}

function readPointerTarget(packet: Buffer, position: number): number {
	return packet.readUInt16BE(position) & POINTER_OFFSET_MASK;
}

function readLabel(packet: Buffer, position: number, labelLength: number): string {
	if (position + 1 + labelLength > packet.length) {
		throw new Error('DNS name decompression reached end of packet unexpectedly');
	}
	return packet.toString('ascii', position + 1, position + 1 + labelLength);
}

export function decompressName(packet: Buffer, offset: number): DecompressedName {
	const labels: string[] = [];
	let currentPosition = offset;
	let bytesConsumed: number | undefined;
	let depth = 0;
	let nameLength = 0;

	for (;;) {
		if (depth > MAX_POINTER_DEPTH) {
			throw new Error(
				`DNS name decompression exceeded maximum pointer depth of ${MAX_POINTER_DEPTH}`,
			);
		}

		if (currentPosition >= packet.length) {
			throw new Error('DNS name decompression reached end of packet unexpectedly');
		}

		const currentByte = packet.readUInt8(currentPosition);

		if (currentByte === 0x00) {
			bytesConsumed ??= currentPosition - offset + 1;
			break;
		}

		if (isPointerByte(currentByte)) {
			bytesConsumed ??= currentPosition - offset + 2;
			const targetOffset = readPointerTarget(packet, currentPosition);
			if (targetOffset >= packet.length) {
				throw new Error(
					`DNS compression pointer references offset ${targetOffset} beyond packet boundary`,
				);
			}
			currentPosition = targetOffset;
			depth++;
			continue;
		}

		const labelLength = currentByte;
		if (labelLength > MAX_LABEL_LENGTH) {
			throw new Error(
				`DNS label length ${labelLength} exceeds maximum of ${MAX_LABEL_LENGTH} bytes`,
			);
		}

		const label = readLabel(packet, currentPosition, labelLength);
		nameLength += (labels.length > 0 ? 1 : 0) + labelLength;
		if (nameLength > DNS_MAX_NAME_LENGTH) {
			throw new Error(`DNS name exceeds maximum length of ${DNS_MAX_NAME_LENGTH} characters`);
		}

		labels.push(label);
		currentPosition += 1 + labelLength;
	}

	return { name: labels.join('.'), bytesConsumed: bytesConsumed! };
}
