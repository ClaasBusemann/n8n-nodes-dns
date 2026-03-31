import { createMockSocket, type MockSocket } from '../helpers/mock-socket';
import type { DnsServer } from '../../src/transport/dns-client';

let mockSocketInstance: MockSocket;
let mockSocketFactory: jest.Mock;

jest.mock('dgram', () => ({
	createSocket: (...args: unknown[]) => mockSocketFactory(...args),
}));

import { querySingleServer, queryMultipleServers } from '../../src/transport/dns-client';

const TEST_SERVER: DnsServer = { address: '1.1.1.1', port: 53 };
const TEST_DOMAIN = 'example.com';
const TEST_RECORD_TYPE = 'A' as const;

function buildResponseBuffer(
	transactionId: number,
	options?: { truncated?: boolean; responseCode?: number; answerCount?: number },
): Buffer {
	const truncated = options?.truncated ?? false;
	const responseCode = options?.responseCode ?? 0;
	const answerCount = options?.answerCount ?? 1;

	const buffer = Buffer.alloc(12 + 17 + 16);
	// Header
	buffer.writeUInt16BE(transactionId, 0);
	// Flags: QR=1, RD=1, RA=1, TC if requested
	let flags = 0x8180 | responseCode;
	if (truncated) flags |= 0x0200;
	buffer.writeUInt16BE(flags, 2);
	buffer.writeUInt16BE(1, 4); // QDCOUNT
	buffer.writeUInt16BE(answerCount, 6); // ANCOUNT
	buffer.writeUInt16BE(0, 8); // NSCOUNT
	buffer.writeUInt16BE(0, 10); // ARCOUNT

	// Question section: example.com A IN
	let offset = 12;
	// \x07example\x03com\x00
	buffer.writeUInt8(7, offset++);
	buffer.write('example', offset, 'ascii');
	offset += 7;
	buffer.writeUInt8(3, offset++);
	buffer.write('com', offset, 'ascii');
	offset += 3;
	buffer.writeUInt8(0, offset++);
	buffer.writeUInt16BE(1, offset); // QTYPE A
	offset += 2;
	buffer.writeUInt16BE(1, offset); // QCLASS IN
	offset += 2;

	if (answerCount > 0) {
		// Answer: compressed name pointer to offset 12
		buffer.writeUInt16BE(0xc00c, offset);
		offset += 2;
		buffer.writeUInt16BE(1, offset); // TYPE A
		offset += 2;
		buffer.writeUInt16BE(1, offset); // CLASS IN
		offset += 2;
		buffer.writeUInt32BE(300, offset); // TTL
		offset += 4;
		buffer.writeUInt16BE(4, offset); // RDLENGTH
		offset += 2;
		// RDATA: 93.184.216.34
		buffer.writeUInt8(93, offset++);
		buffer.writeUInt8(184, offset++);
		buffer.writeUInt8(216, offset++);
		buffer.writeUInt8(34, offset++);
	}

	return buffer.subarray(0, offset);
}

function setupMockSocket(behavior?: Parameters<typeof createMockSocket>[0]): void {
	mockSocketInstance = createMockSocket(behavior);
	mockSocketFactory = jest.fn().mockReturnValue(mockSocketInstance);
}

function setupMockSocketSequence(sockets: MockSocket[]): void {
	mockSocketFactory = jest.fn();
	for (let socketIndex = 0; socketIndex < sockets.length; socketIndex++) {
		mockSocketFactory.mockReturnValueOnce(sockets[socketIndex]);
	}
	mockSocketInstance = sockets[0]!;
}

function getTransactionIdFromSentPacket(): number {
	const sendCall = mockSocketInstance.send.mock.calls[0] as [
		Buffer,
		number,
		number,
		number,
		string,
	];
	return sendCall[0].readUInt16BE(0);
}

describe('querySingleServer', () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('returns decoded response for successful query', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
		});

		await jest.advanceTimersByTimeAsync(0);
		const transactionId = getTransactionIdFromSentPacket();
		const responseBuffer = buildResponseBuffer(transactionId);
		mockSocketInstance.emitMessage(responseBuffer);
		await jest.advanceTimersByTimeAsync(0);

		const result = await resultPromise;
		expect(result.responseCode).toBe('NOERROR');
		expect(result.truncated).toBe(false);
		expect(result.response).not.toBeNull();
		expect(result.server).toEqual(TEST_SERVER);
		expect(result.responseTimeMilliseconds).toBeGreaterThanOrEqual(0);
	});

	it('ignores responses with mismatched transaction ID', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
		});

		await jest.advanceTimersByTimeAsync(0);
		const transactionId = getTransactionIdFromSentPacket();

		// Send wrong transaction ID first
		const wrongResponse = buildResponseBuffer(transactionId === 0 ? 1 : transactionId - 1);
		mockSocketInstance.emitMessage(wrongResponse);
		await jest.advanceTimersByTimeAsync(0);

		// Send correct transaction ID
		const correctResponse = buildResponseBuffer(transactionId);
		mockSocketInstance.emitMessage(correctResponse);
		await jest.advanceTimersByTimeAsync(0);

		const result = await resultPromise;
		expect(result.responseCode).toBe('NOERROR');
		expect(result.response).not.toBeNull();
	});

	it('times out when only mismatched transaction IDs are received', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 100,
			retryCount: 0,
		});

		await jest.advanceTimersByTimeAsync(0);
		const transactionId = getTransactionIdFromSentPacket();

		const wrongResponse = buildResponseBuffer(transactionId === 0 ? 1 : transactionId - 1);
		mockSocketInstance.emitMessage(wrongResponse);
		await jest.advanceTimersByTimeAsync(100);

		const result = await resultPromise;
		expect(result.responseCode).toBe('TIMEOUT');
		expect(result.response).toBeNull();
	});

	it('returns TIMEOUT when no response is received', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 100,
			retryCount: 0,
		});

		await jest.advanceTimersByTimeAsync(100);

		const result = await resultPromise;
		expect(result.responseCode).toBe('TIMEOUT');
		expect(result.response).toBeNull();
		expect(result.truncated).toBe(false);
		expect(result.responseTimeMilliseconds).toBe(0);
	});

	it('retries on timeout and succeeds on second attempt', async () => {
		const firstSocket = createMockSocket();
		const secondSocket = createMockSocket();
		setupMockSocketSequence([firstSocket, secondSocket]);

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 100,
			retryCount: 1,
		});

		// First attempt times out
		await jest.advanceTimersByTimeAsync(100);

		// Second attempt — get transaction ID from second socket's send call
		await jest.advanceTimersByTimeAsync(0);
		const secondSendCall = secondSocket.send.mock.calls[0] as [
			Buffer,
			number,
			number,
			number,
			string,
		];
		const transactionId = secondSendCall[0].readUInt16BE(0);
		const responseBuffer = buildResponseBuffer(transactionId);
		secondSocket.emitMessage(responseBuffer);
		await jest.advanceTimersByTimeAsync(0);

		const result = await resultPromise;
		expect(result.responseCode).toBe('NOERROR');
		expect(mockSocketFactory).toHaveBeenCalledTimes(2);
		expect(firstSocket.close).toHaveBeenCalled();
		expect(secondSocket.close).toHaveBeenCalled();
	});

	it('returns TIMEOUT after exhausting all retry attempts', async () => {
		const sockets = [createMockSocket(), createMockSocket(), createMockSocket()];
		setupMockSocketSequence(sockets);

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 100,
			retryCount: 2,
		});

		// All three attempts time out
		await jest.advanceTimersByTimeAsync(100);
		await jest.advanceTimersByTimeAsync(100);
		await jest.advanceTimersByTimeAsync(100);

		const result = await resultPromise;
		expect(result.responseCode).toBe('TIMEOUT');
		expect(mockSocketFactory).toHaveBeenCalledTimes(3);
	});

	it('respects custom timeout value', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 50,
			retryCount: 0,
		});

		// Not timed out at 49ms
		await jest.advanceTimersByTimeAsync(49);
		expect(mockSocketInstance.close).not.toHaveBeenCalled();

		// Timed out at 50ms
		await jest.advanceTimersByTimeAsync(1);

		const result = await resultPromise;
		expect(result.responseCode).toBe('TIMEOUT');
	});

	it('flags truncated responses without throwing', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
		});

		await jest.advanceTimersByTimeAsync(0);
		const transactionId = getTransactionIdFromSentPacket();
		const responseBuffer = buildResponseBuffer(transactionId, { truncated: true });
		mockSocketInstance.emitMessage(responseBuffer);
		await jest.advanceTimersByTimeAsync(0);

		const result = await resultPromise;
		expect(result.truncated).toBe(true);
		expect(result.responseCode).toBe('NOERROR');
		expect(result.response).not.toBeNull();
	});

	it('throws on network unreachable error', async () => {
		const networkError = new Error('connect ENETUNREACH 1.1.1.1:53');
		(networkError as NodeJS.ErrnoException).code = 'ENETUNREACH';
		setupMockSocket({ socketError: networkError });

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
		});

		jest.advanceTimersByTime(0);
		await expect(resultPromise).rejects.toThrow('DNS query to 1.1.1.1:53 failed');
	});

	it('throws on socket send failure', async () => {
		const sendError = new Error('send failed');
		setupMockSocket({ sendError });

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
		});

		await expect(resultPromise).rejects.toThrow('DNS query to 1.1.1.1:53 failed');
	});

	it('always closes the socket on success', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
		});

		await jest.advanceTimersByTimeAsync(0);
		const transactionId = getTransactionIdFromSentPacket();
		mockSocketInstance.emitMessage(buildResponseBuffer(transactionId));
		await jest.advanceTimersByTimeAsync(0);

		await resultPromise;
		expect(mockSocketInstance.close).toHaveBeenCalledTimes(1);
	});

	it('always closes the socket on timeout', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 100,
			retryCount: 0,
		});

		await jest.advanceTimersByTimeAsync(100);
		await resultPromise;
		expect(mockSocketInstance.close).toHaveBeenCalledTimes(1);
	});

	it('always closes the socket on error', async () => {
		const socketError = new Error('network error');
		setupMockSocket({ socketError });

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
		});

		jest.advanceTimersByTime(0);
		await expect(resultPromise).rejects.toThrow();
		expect(mockSocketInstance.close).toHaveBeenCalledTimes(1);
	});

	it('uses default timeout and retry count when no options provided', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER);

		await jest.advanceTimersByTimeAsync(0);
		const transactionId = getTransactionIdFromSentPacket();
		mockSocketInstance.emitMessage(buildResponseBuffer(transactionId));
		await jest.advanceTimersByTimeAsync(0);

		const result = await resultPromise;
		expect(result.responseCode).toBe('NOERROR');
	});

	it('forwards recursion desired flag to query encoding', async () => {
		setupMockSocket();

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
			recursionDesired: false,
		});

		await jest.advanceTimersByTimeAsync(0);
		const sendCall = mockSocketInstance.send.mock.calls[0] as [
			Buffer,
			number,
			number,
			number,
			string,
		];
		const sentPacket = sendCall[0];
		// RD bit is bit 8 of the flags word (bytes 2-3)
		const flagsWord = sentPacket.readUInt16BE(2);
		const recursionDesired = (flagsWord & 0x0100) !== 0;
		expect(recursionDesired).toBe(false);

		// Complete the query to avoid dangling promise
		const transactionId = sentPacket.readUInt16BE(0);
		mockSocketInstance.emitMessage(buildResponseBuffer(transactionId));
		await jest.advanceTimersByTimeAsync(0);
		await resultPromise;
	});

	it('does not retry on non-timeout errors', async () => {
		const networkError = new Error('connect ENETUNREACH');
		(networkError as NodeJS.ErrnoException).code = 'ENETUNREACH';
		setupMockSocket({ socketError: networkError });

		const resultPromise = querySingleServer(TEST_DOMAIN, TEST_RECORD_TYPE, TEST_SERVER, {
			timeoutMilliseconds: 1000,
			retryCount: 2,
		});

		jest.advanceTimersByTime(0);
		await expect(resultPromise).rejects.toThrow();
		// Only one socket created — no retries for network errors
		expect(mockSocketFactory).toHaveBeenCalledTimes(1);
	});
});

describe('queryMultipleServers', () => {
	const SERVER_A: DnsServer = { address: '1.1.1.1', port: 53 };
	const SERVER_B: DnsServer = { address: '8.8.8.8', port: 53 };

	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('returns results from all servers when both succeed', async () => {
		const socketA = createMockSocket();
		const socketB = createMockSocket();
		mockSocketFactory = jest.fn().mockReturnValueOnce(socketA).mockReturnValueOnce(socketB);

		const resultPromise = queryMultipleServers(
			TEST_DOMAIN,
			TEST_RECORD_TYPE,
			[SERVER_A, SERVER_B],
			{
				timeoutMilliseconds: 1000,
			},
		);

		await jest.advanceTimersByTimeAsync(0);

		const transactionIdA = (socketA.send.mock.calls[0] as [Buffer])[0].readUInt16BE(0);
		const transactionIdB = (socketB.send.mock.calls[0] as [Buffer])[0].readUInt16BE(0);

		socketA.emitMessage(buildResponseBuffer(transactionIdA));
		socketB.emitMessage(buildResponseBuffer(transactionIdB));
		await jest.advanceTimersByTimeAsync(0);

		const result = await resultPromise;
		expect(result.results).toHaveLength(2);
		expect(result.results[0]!.server).toEqual(SERVER_A);
		expect(result.results[1]!.server).toEqual(SERVER_B);
		expect(result.results[0]!.responseCode).toBe('NOERROR');
		expect(result.results[1]!.responseCode).toBe('NOERROR');
	});

	it('returns success and timeout when one server does not respond', async () => {
		const socketA = createMockSocket();
		const socketB = createMockSocket();
		mockSocketFactory = jest.fn().mockReturnValueOnce(socketA).mockReturnValueOnce(socketB);

		const resultPromise = queryMultipleServers(
			TEST_DOMAIN,
			TEST_RECORD_TYPE,
			[SERVER_A, SERVER_B],
			{
				timeoutMilliseconds: 100,
				retryCount: 0,
			},
		);

		await jest.advanceTimersByTimeAsync(0);

		// Only server A responds
		const transactionIdA = (socketA.send.mock.calls[0] as [Buffer])[0].readUInt16BE(0);
		socketA.emitMessage(buildResponseBuffer(transactionIdA));

		await jest.advanceTimersByTimeAsync(100);

		const result = await resultPromise;
		expect(result.results).toHaveLength(2);
		expect(result.results[0]!.responseCode).toBe('NOERROR');
		expect(result.results[1]!.responseCode).toBe('TIMEOUT');
	});

	it('returns all TIMEOUT when no servers respond', async () => {
		const socketA = createMockSocket();
		const socketB = createMockSocket();
		mockSocketFactory = jest.fn().mockReturnValueOnce(socketA).mockReturnValueOnce(socketB);

		const resultPromise = queryMultipleServers(
			TEST_DOMAIN,
			TEST_RECORD_TYPE,
			[SERVER_A, SERVER_B],
			{
				timeoutMilliseconds: 100,
				retryCount: 0,
			},
		);

		await jest.advanceTimersByTimeAsync(100);

		const result = await resultPromise;
		expect(result.results).toHaveLength(2);
		expect(result.results[0]!.responseCode).toBe('TIMEOUT');
		expect(result.results[1]!.responseCode).toBe('TIMEOUT');
	});

	it('handles one network error without affecting other servers', async () => {
		const networkError = new Error('connect ENETUNREACH');
		(networkError as NodeJS.ErrnoException).code = 'ENETUNREACH';
		const socketA = createMockSocket({ socketError: networkError });
		const socketB = createMockSocket();
		mockSocketFactory = jest.fn().mockReturnValueOnce(socketA).mockReturnValueOnce(socketB);

		const resultPromise = queryMultipleServers(
			TEST_DOMAIN,
			TEST_RECORD_TYPE,
			[SERVER_A, SERVER_B],
			{
				timeoutMilliseconds: 1000,
				retryCount: 0,
			},
		);

		await jest.advanceTimersByTimeAsync(0);

		const transactionIdB = (socketB.send.mock.calls[0] as [Buffer])[0].readUInt16BE(0);
		socketB.emitMessage(buildResponseBuffer(transactionIdB));
		await jest.advanceTimersByTimeAsync(0);

		const result = await resultPromise;
		expect(result.results).toHaveLength(2);
		// Server A failed with network error — captured, not thrown
		expect(result.results[0]!.response).toBeNull();
		// Server B succeeded
		expect(result.results[1]!.responseCode).toBe('NOERROR');
	});

	it('returns empty results for empty server list', async () => {
		const result = await queryMultipleServers(TEST_DOMAIN, TEST_RECORD_TYPE, []);
		expect(result.results).toHaveLength(0);
	});

	it('dispatches queries concurrently', async () => {
		const socketA = createMockSocket();
		const socketB = createMockSocket();
		mockSocketFactory = jest.fn().mockReturnValueOnce(socketA).mockReturnValueOnce(socketB);

		queryMultipleServers(TEST_DOMAIN, TEST_RECORD_TYPE, [SERVER_A, SERVER_B], {
			timeoutMilliseconds: 1000,
		});

		await jest.advanceTimersByTimeAsync(0);

		// Both sockets should have been created and sent to before any response
		expect(socketA.send).toHaveBeenCalledTimes(1);
		expect(socketB.send).toHaveBeenCalledTimes(1);

		// Clean up — respond to both
		const transactionIdA = (socketA.send.mock.calls[0] as [Buffer])[0].readUInt16BE(0);
		const transactionIdB = (socketB.send.mock.calls[0] as [Buffer])[0].readUInt16BE(0);
		socketA.emitMessage(buildResponseBuffer(transactionIdA));
		socketB.emitMessage(buildResponseBuffer(transactionIdB));
		await jest.advanceTimersByTimeAsync(0);
	});
});
