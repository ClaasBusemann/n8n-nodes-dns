export function buildPacket(...segments: (number | string)[]): Buffer {
	const buffers = segments.map((segment) =>
		typeof segment === 'number' ? Buffer.from([segment]) : Buffer.from(segment, 'ascii'),
	);
	return Buffer.concat(buffers);
}
