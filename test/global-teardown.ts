import { stopTestDnsServer } from './helpers/dns-server';

export default async function globalTeardown() {
	// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test infrastructure: env var check for conditional teardown
	if (process.env.RUN_INTEGRATION_TESTS !== '1') return;

	await stopTestDnsServer();
}
