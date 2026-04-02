// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports -- Node.js built-in needed for state file I/O
import * as fs from 'fs';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports -- Node.js built-in needed for state file path
import * as path from 'path';
import { DnsTestServer } from './dns-test-server';
import type { DnsServer } from '../../src/transport/dns-client';

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test infrastructure: __dirname needed for state file path
const STATE_FILE = path.join(__dirname, '..', '.dns-server-state.json');

let server: DnsTestServer | null = null;

export async function startTestDnsServer(): Promise<DnsServer> {
	server = new DnsTestServer();
	const address = await server.start();

	fs.writeFileSync(STATE_FILE, JSON.stringify({ port: address.port }));

	return address;
}

export function readTestDnsServer(): DnsServer {
	const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
	return { address: '127.0.0.1', port: state.port };
}

export async function stopTestDnsServer(): Promise<void> {
	if (server) {
		await server.stop();
		server = null;
	}
	try {
		fs.unlinkSync(STATE_FILE);
	} catch {
		// ignore if file doesn't exist
	}
}
