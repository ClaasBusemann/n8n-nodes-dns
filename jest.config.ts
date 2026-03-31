// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports -- dev-only: jest config
import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/test'],
	testMatch: ['<rootDir>/test/unit/**/*.test.ts', '<rootDir>/test/integration/**/*.test.ts'],
	transform: {
		'^.+\\.ts$': [
			'ts-jest',
			{
				tsconfig: 'tsconfig.test.json',
			},
		],
	},
	collectCoverageFrom: ['src/**/*.ts', '!**/*.d.ts'],
	coverageDirectory: 'coverage',
	coverageThreshold: {
		global: {
			lines: 80,
			branches: 65,
		},
	},
};

export default config;
