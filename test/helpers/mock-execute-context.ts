import type { IExecuteFunctions, INode, INodeExecutionData, IPollFunctions } from 'n8n-workflow';

interface MockExecuteContextOptions {
	nodeParameters: Record<string, unknown>;
	inputItems?: INodeExecutionData[];
	continueOnFail?: boolean;
}

interface MockPollContextOptions {
	nodeParameters: Record<string, unknown>;
	staticData: Record<string, unknown>;
}

const MOCK_NODE: INode = {
	id: 'test-node-id',
	name: 'TestNode',
	type: 'n8n-nodes-dns.dnsLookup',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function applyPairedItem(
	items: INodeExecutionData[],
	itemData: { item: number } | { item: number }[],
): INodeExecutionData[] {
	return items.map((item) => ({
		...item,
		pairedItem: itemData,
	}));
}

export function createMockExecuteContext(options: MockExecuteContextOptions): IExecuteFunctions {
	const { nodeParameters, continueOnFail = false } = options;
	const inputItems = options.inputItems ?? [{ json: {} }];

	return {
		getInputData: jest.fn(() => inputItems),
		getNodeParameter: jest.fn((name: string, _itemIndex: number, fallbackValue?: unknown) => {
			const value = nodeParameters[name];
			return value !== undefined ? value : fallbackValue;
		}),
		getNode: jest.fn(() => MOCK_NODE),
		continueOnFail: jest.fn(() => continueOnFail),
		addExecutionHints: jest.fn(),
		helpers: {
			constructExecutionMetaData: jest.fn(
				(
					inputData: INodeExecutionData[],
					metadataOptions: { itemData: { item: number } | { item: number }[] },
				) => applyPairedItem(inputData, metadataOptions.itemData),
			),
		},
	} as unknown as IExecuteFunctions;
}

export function createMockPollContext(options: MockPollContextOptions): IPollFunctions {
	const { nodeParameters, staticData } = options;

	return {
		getNodeParameter: jest.fn((name: string, fallbackValue?: unknown) => {
			const value = nodeParameters[name];
			return value !== undefined ? value : fallbackValue;
		}),
		getNode: jest.fn(() => ({
			...MOCK_NODE,
			type: 'n8n-nodes-dns.dnsWatch',
		})),
		getWorkflowStaticData: jest.fn(() => staticData),
		logger: {
			warn: jest.fn(),
			info: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		},
	} as unknown as IPollFunctions;
}
