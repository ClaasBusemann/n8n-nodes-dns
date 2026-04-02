// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- process.env needed to gate integration tests
const SHOULD_RUN = process.env.RUN_INTEGRATION_TESTS === '1';

export const describeIntegration = SHOULD_RUN ? describe : describe.skip;
