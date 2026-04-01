import type { FormattedRecord } from '../../src/nodes/shared/dns-node-helpers';

export function makeFormattedRecord(overrides: Partial<FormattedRecord> = {}): FormattedRecord {
	return {
		name: 'example.com',
		type: 'A',
		ttl: 300,
		value: '93.184.216.34',
		...overrides,
	};
}
