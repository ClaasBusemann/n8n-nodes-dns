import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class DnsLookup implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DNS Lookup',
		name: 'dnsLookup',
		icon: 'file:dnsLookup.svg',
		group: ['input'],
		version: [1],
		description: 'Perform raw DNS queries using the DNS wire protocol',
		defaults: {
			name: 'DNS Lookup',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return [this.getInputData()];
	}
}
