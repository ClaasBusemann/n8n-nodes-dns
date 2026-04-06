import { serializeAnswerValues } from '../../src/nodes/shared/dns-node-helpers';
import {
	checkFireCondition,
	answersContainValue,
	evaluatePollFireCondition,
} from '../../src/nodes/DnsWatch/DnsWatch.node';
import { makeFormattedRecord } from '../helpers/mock-dns-records';

function makeFireConditionContext(
	overrides: Partial<Parameters<typeof checkFireCondition>[1]> = {},
) {
	const defaultAnswers = [makeFormattedRecord()];
	const defaultHash = serializeAnswerValues(defaultAnswers);
	return {
		currentHash: defaultHash,
		previousHash: defaultHash,
		currentHasRecords: true,
		previousHadRecords: true,
		currentAnswers: defaultAnswers,
		expectedValue: '',
		...overrides,
	};
}

describe('answersContainValue', () => {
	it('matches a plain string value', () => {
		const answers = [makeFormattedRecord({ value: '93.184.216.34' })];

		expect(answersContainValue(answers, '93.184.216.34')).toBe(true);
	});

	it('does not match when value differs', () => {
		const answers = [makeFormattedRecord({ value: '93.184.216.34' })];

		expect(answersContainValue(answers, '1.2.3.4')).toBe(false);
	});

	it('matches among multiple answers', () => {
		const answers = [
			makeFormattedRecord({ value: '1.1.1.1' }),
			makeFormattedRecord({ value: '2.2.2.2' }),
			makeFormattedRecord({ value: '3.3.3.3' }),
		];

		expect(answersContainValue(answers, '2.2.2.2')).toBe(true);
	});

	it('returns false for empty answers', () => {
		expect(answersContainValue([], '1.1.1.1')).toBe(false);
	});

	it('matches complex record values via JSON stringification', () => {
		const mxValue = { priority: 10, exchange: 'mail.example.com' };
		const answers = [makeFormattedRecord({ value: mxValue })];

		expect(answersContainValue(answers, JSON.stringify(mxValue))).toBe(true);
	});

	it('does not match partial strings', () => {
		const answers = [makeFormattedRecord({ value: '93.184.216.34' })];

		expect(answersContainValue(answers, '93.184')).toBe(false);
	});
});

describe('checkFireCondition', () => {
	describe('anyChange', () => {
		it('fires when answer hash changes', () => {
			const context = makeFireConditionContext({
				previousHash: serializeAnswerValues([makeFormattedRecord({ value: '1.1.1.1' })]),
				currentHash: serializeAnswerValues([makeFormattedRecord({ value: '2.2.2.2' })]),
			});

			expect(checkFireCondition('anyChange', context)).toBe(true);
		});

		it('does not fire when answers are identical', () => {
			const context = makeFireConditionContext();

			expect(checkFireCondition('anyChange', context)).toBe(false);
		});

		it('fires when answers go from records to empty', () => {
			const context = makeFireConditionContext({
				previousHash: serializeAnswerValues([makeFormattedRecord()]),
				currentHash: serializeAnswerValues([]),
				currentAnswers: [],
				currentHasRecords: false,
			});

			expect(checkFireCondition('anyChange', context)).toBe(true);
		});
	});

	describe('recordAppears', () => {
		it('fires when records appear after having none', () => {
			const context = makeFireConditionContext({
				previousHadRecords: false,
				currentHasRecords: true,
			});

			expect(checkFireCondition('recordAppears', context)).toBe(true);
		});

		it('does not fire when records already existed', () => {
			const context = makeFireConditionContext({
				previousHadRecords: true,
				currentHasRecords: true,
			});

			expect(checkFireCondition('recordAppears', context)).toBe(false);
		});

		it('does not fire when still no records', () => {
			const context = makeFireConditionContext({
				previousHadRecords: false,
				currentHasRecords: false,
			});

			expect(checkFireCondition('recordAppears', context)).toBe(false);
		});

		it('does not fire when records disappear', () => {
			const context = makeFireConditionContext({
				previousHadRecords: true,
				currentHasRecords: false,
			});

			expect(checkFireCondition('recordAppears', context)).toBe(false);
		});
	});

	describe('recordDisappears', () => {
		it('fires when records disappear', () => {
			const context = makeFireConditionContext({
				previousHadRecords: true,
				currentHasRecords: false,
			});

			expect(checkFireCondition('recordDisappears', context)).toBe(true);
		});

		it('does not fire when records still exist', () => {
			const context = makeFireConditionContext({
				previousHadRecords: true,
				currentHasRecords: true,
			});

			expect(checkFireCondition('recordDisappears', context)).toBe(false);
		});

		it('does not fire when there were no records before', () => {
			const context = makeFireConditionContext({
				previousHadRecords: false,
				currentHasRecords: false,
			});

			expect(checkFireCondition('recordDisappears', context)).toBe(false);
		});

		it('does not fire when records appear', () => {
			const context = makeFireConditionContext({
				previousHadRecords: false,
				currentHasRecords: true,
			});

			expect(checkFireCondition('recordDisappears', context)).toBe(false);
		});
	});

	describe('valueMatches', () => {
		it('fires when answer changes and contains expected value', () => {
			const currentAnswers = [makeFormattedRecord({ value: '10.0.0.1' })];
			const context = makeFireConditionContext({
				previousHash: serializeAnswerValues([makeFormattedRecord({ value: '1.1.1.1' })]),
				currentHash: serializeAnswerValues(currentAnswers),
				currentAnswers,
				expectedValue: '10.0.0.1',
			});

			expect(checkFireCondition('valueMatches', context)).toBe(true);
		});

		it('does not fire when answer is unchanged even if value matches', () => {
			const answers = [makeFormattedRecord({ value: '10.0.0.1' })];
			const hash = serializeAnswerValues(answers);
			const context = makeFireConditionContext({
				previousHash: hash,
				currentHash: hash,
				currentAnswers: answers,
				expectedValue: '10.0.0.1',
			});

			expect(checkFireCondition('valueMatches', context)).toBe(false);
		});

		it('does not fire when answer changes but value does not match', () => {
			const currentAnswers = [makeFormattedRecord({ value: '10.0.0.1' })];
			const context = makeFireConditionContext({
				previousHash: serializeAnswerValues([makeFormattedRecord({ value: '1.1.1.1' })]),
				currentHash: serializeAnswerValues(currentAnswers),
				currentAnswers,
				expectedValue: '99.99.99.99',
			});

			expect(checkFireCondition('valueMatches', context)).toBe(false);
		});

		it('matches expected value among multiple records', () => {
			const currentAnswers = [
				makeFormattedRecord({ value: '10.0.0.1' }),
				makeFormattedRecord({ value: '10.0.0.2' }),
			];
			const context = makeFireConditionContext({
				previousHash: serializeAnswerValues([makeFormattedRecord({ value: '1.1.1.1' })]),
				currentHash: serializeAnswerValues(currentAnswers),
				currentAnswers,
				expectedValue: '10.0.0.2',
			});

			expect(checkFireCondition('valueMatches', context)).toBe(true);
		});
	});

	it('throws for an unknown fire condition mode', () => {
		const context = makeFireConditionContext();

		expect(() => checkFireCondition('unknownMode', context)).toThrow(
			'Unknown fire condition mode: unknownMode',
		);
	});
});

describe('evaluatePollFireCondition', () => {
	const answers = [makeFormattedRecord({ value: '1.1.1.1' })];
	const hash = serializeAnswerValues(answers);

	function makeContext(
		overrides: Partial<Parameters<typeof evaluatePollFireCondition>[0]> = {},
	): Parameters<typeof evaluatePollFireCondition>[0] {
		return {
			currentHash: hash,
			currentHasRecords: true,
			currentAnswers: answers,
			staticData: {},
			fireOn: 'anyChange',
			expectedValue: '',
			isManualTest: false,
			...overrides,
		};
	}

	it('initializes state and returns false on first poll (non-manual)', () => {
		const staticData: { previousAnswerHash?: string; previousHadRecords?: boolean } = {};
		const result = evaluatePollFireCondition(makeContext({ staticData }));

		expect(result).toBe(false);
		expect(staticData.previousAnswerHash).toBe(hash);
		expect(staticData.previousHadRecords).toBe(true);
	});

	it('initializes state and returns true on first poll (manual test)', () => {
		const staticData: { previousAnswerHash?: string; previousHadRecords?: boolean } = {};
		const result = evaluatePollFireCondition(makeContext({ staticData, isManualTest: true }));

		expect(result).toBe(true);
		expect(staticData.previousAnswerHash).toBe(hash);
	});

	it('always returns true for manual test after initialization', () => {
		const staticData = { previousAnswerHash: hash, previousHadRecords: true };
		const result = evaluatePollFireCondition(makeContext({ staticData, isManualTest: true }));

		expect(result).toBe(true);
	});

	it('returns true when fire condition is met', () => {
		const oldHash = serializeAnswerValues([makeFormattedRecord({ value: '2.2.2.2' })]);
		const staticData = { previousAnswerHash: oldHash, previousHadRecords: true };
		const result = evaluatePollFireCondition(makeContext({ staticData }));

		expect(result).toBe(true);
		expect(staticData.previousAnswerHash).toBe(hash);
	});

	it('returns false when fire condition is not met', () => {
		const staticData = { previousAnswerHash: hash, previousHadRecords: true };
		const result = evaluatePollFireCondition(makeContext({ staticData }));

		expect(result).toBe(false);
	});

	it('updates staticData after evaluation', () => {
		const oldHash = serializeAnswerValues([makeFormattedRecord({ value: '9.9.9.9' })]);
		const staticData = { previousAnswerHash: oldHash, previousHadRecords: false };
		evaluatePollFireCondition(makeContext({ staticData }));

		expect(staticData.previousAnswerHash).toBe(hash);
		expect(staticData.previousHadRecords).toBe(true);
	});
});
