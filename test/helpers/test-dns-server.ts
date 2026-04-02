import { readTestDnsServer } from './dns-server';
import type { DnsServer } from '../../src/transport/dns-client';

export function getTestServer(): DnsServer {
	try {
		return readTestDnsServer();
	} catch {
		// Fallback for when tests run without the global setup (e.g. unit tests)
		return { address: '127.0.0.1', port: 0 };
	}
}
