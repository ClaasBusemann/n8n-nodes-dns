export interface MockSocketBehavior {
	responseBuffer?: Buffer;
	responseDelayMilliseconds?: number;
	sendError?: Error;
	socketError?: Error;
}

export interface MockSocket {
	on: jest.Mock;
	send: jest.Mock;
	close: jest.Mock;
	emitMessage: (buffer: Buffer) => void;
	emitError: (error: Error) => void;
}

export function createMockSocket(behavior?: MockSocketBehavior): MockSocket {
	const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

	const emitMessage = (buffer: Buffer) => {
		const handlers = listeners['message'];
		if (handlers) {
			for (const handler of handlers) {
				handler(buffer);
			}
		}
	};

	const emitError = (error: Error) => {
		const handlers = listeners['error'];
		if (handlers) {
			for (const handler of handlers) {
				handler(error);
			}
		}
	};

	const on = jest.fn((event: string, handler: (...args: unknown[]) => void) => {
		if (!listeners[event]) {
			listeners[event] = [];
		}
		listeners[event]!.push(handler);
		return mockSocket;
	});

	const send = jest.fn(
		(
			_buffer: Buffer,
			_offset: number,
			_length: number,
			_port: number,
			_address: string,
			callback?: (error: Error | null) => void,
		) => {
			if (behavior?.sendError) {
				if (callback) callback(behavior.sendError);
				return;
			}

			if (callback) callback(null);

			if (behavior?.socketError) {
				const delay = behavior.responseDelayMilliseconds ?? 0;
				// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test helper simulating delayed socket events
				setTimeout(() => emitError(behavior.socketError!), delay);
				return;
			}

			if (behavior?.responseBuffer) {
				const delay = behavior.responseDelayMilliseconds ?? 0;
				// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test helper simulating delayed socket events
				setTimeout(() => emitMessage(behavior.responseBuffer!), delay);
			}
		},
	);

	const close = jest.fn();

	const mockSocket: MockSocket = { on, send, close, emitMessage, emitError };
	return mockSocket;
}
