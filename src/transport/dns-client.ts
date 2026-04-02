// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports -- dgram is a Node.js built-in for raw UDP DNS queries, not an external dependency
import * as dgram from 'dgram';
import { encodeQuery, decodeResponse, RESPONSE_CODE_NAMES } from './dns-packet';
import type { DnsRecordType, DnsResponse } from './dns-packet';

export interface DnsServer {
	address: string;
	port: number;
}

export interface DnsClientOptions {
	timeoutMilliseconds?: number;
	retryCount?: number;
	recursionDesired?: boolean;
}

export interface DnsServerResult {
	server: DnsServer;
	response: DnsResponse | null;
	responseCode: string;
	truncated: boolean;
	responseTimeMilliseconds: number;
}

export interface DnsQueryResult {
	results: DnsServerResult[];
}

const DEFAULT_TIMEOUT_MILLISECONDS = 5000;
const DEFAULT_RETRY_COUNT = 1;
const TIMEOUT_RESPONSE_CODE = 'TIMEOUT';
const UNKNOWN_RESPONSE_CODE = 'UNKNOWN';

class DnsTimeoutError extends Error {
	readonly code = 'ETIMEOUT';
	constructor(server: DnsServer) {
		super(`DNS query to ${server.address}:${server.port} timed out`);
	}
}

function extractTransactionId(packet: Buffer): number {
	return packet.readUInt16BE(0);
}

function isTimeoutError(error: unknown): boolean {
	return error instanceof DnsTimeoutError;
}

function sendQuery(
	packet: Buffer,
	expectedTransactionId: number,
	server: DnsServer,
	timeoutMilliseconds: number,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const socket = dgram.createSocket('udp4');

		function trySettle(): boolean {
			if (settled) return false;
			settled = true;
			// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- n8n has no timer API; needed for UDP socket timeout
			clearTimeout(timer);
			socket.close();
			return true;
		}

		// timer is referenced in trySettle via closure; only called after assignment
		// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- n8n has no timer API; needed for UDP socket timeout
		const timer = setTimeout(() => {
			if (trySettle()) reject(new DnsTimeoutError(server));
		}, timeoutMilliseconds);

		socket.on('message', (message: Buffer) => {
			if (message.readUInt16BE(0) !== expectedTransactionId) return;
			if (trySettle()) resolve(message);
		});

		socket.on('error', (error: Error) => {
			if (trySettle()) reject(error);
		});

		socket.send(packet, 0, packet.length, server.port, server.address, (sendError) => {
			if (sendError && trySettle()) reject(sendError);
		});
	});
}

async function queryWithRetry(
	packet: Buffer,
	expectedTransactionId: number,
	server: DnsServer,
	timeoutMilliseconds: number,
	retryCount: number,
): Promise<Buffer> {
	const totalAttempts = 1 + retryCount;
	for (let attempt = 0; attempt < totalAttempts; attempt++) {
		try {
			return await sendQuery(packet, expectedTransactionId, server, timeoutMilliseconds);
		} catch (error) {
			const isLastAttempt = attempt === totalAttempts - 1;
			if (!isTimeoutError(error) || isLastAttempt) throw error;
		}
	}
	// Unreachable — the loop always either returns or throws on the last attempt
	throw new DnsTimeoutError(server);
}

function buildServerResult(
	server: DnsServer,
	response: DnsResponse,
	responseTimeMilliseconds: number,
): DnsServerResult {
	const numericCode = response.header.flags.responseCode;
	const responseCode = RESPONSE_CODE_NAMES[numericCode] ?? UNKNOWN_RESPONSE_CODE;
	return {
		server,
		response,
		responseCode,
		truncated: response.header.flags.truncated,
		responseTimeMilliseconds,
	};
}

function buildTimeoutResult(server: DnsServer): DnsServerResult {
	return {
		server,
		response: null,
		responseCode: TIMEOUT_RESPONSE_CODE,
		truncated: false,
		responseTimeMilliseconds: 0,
	};
}

function buildNetworkErrorResult(server: DnsServer, error: Error): DnsServerResult {
	return {
		server,
		response: null,
		responseCode: error.message,
		truncated: false,
		responseTimeMilliseconds: 0,
	};
}

export async function querySingleServer(
	domain: string,
	recordType: DnsRecordType,
	server: DnsServer,
	options?: DnsClientOptions,
): Promise<DnsServerResult> {
	const timeoutMilliseconds = options?.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
	const retryCount = options?.retryCount ?? DEFAULT_RETRY_COUNT;
	const recursionDesired = options?.recursionDesired ?? true;

	const packet = encodeQuery(domain, recordType, { recursionDesired });
	const transactionId = extractTransactionId(packet);
	const startTime = Date.now();

	try {
		const responseBuffer = await queryWithRetry(
			packet,
			transactionId,
			server,
			timeoutMilliseconds,
			retryCount,
		);
		const response = decodeResponse(responseBuffer);
		const elapsed = Date.now() - startTime;
		return buildServerResult(server, response, elapsed);
	} catch (error) {
		if (isTimeoutError(error)) return buildTimeoutResult(server);
		const message =
			`DNS query to ${server.address}:${server.port} failed: ` +
			(error instanceof Error ? error.message : String(error));
		throw new Error(message);
	}
}

export async function queryMultipleServers(
	domain: string,
	recordType: DnsRecordType,
	servers: DnsServer[],
	options?: DnsClientOptions,
): Promise<DnsQueryResult> {
	if (servers.length === 0) return { results: [] };

	const promises = servers.map((server) => querySingleServer(domain, recordType, server, options));
	const settled = await Promise.allSettled(promises);

	const results = settled.map((outcome, index) => {
		if (outcome.status === 'fulfilled') return outcome.value;
		const server = servers[index]!;
		const error =
			outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
		return buildNetworkErrorResult(server, error);
	});

	return { results };
}
