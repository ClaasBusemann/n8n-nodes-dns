import { startTestDnsServer } from './helpers/dns-server';

export default async function globalSetup() {
	// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test infrastructure: env var check for conditional setup
	if (process.env.RUN_INTEGRATION_TESTS !== '1') return;

	const server = await startTestDnsServer();
	// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test infrastructure: pass container port to test workers
	process.env.DNS_TEST_PORT = server.port.toString();
}
