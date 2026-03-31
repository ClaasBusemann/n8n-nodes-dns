import type {
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class DnsWatch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DNS Watch',
		name: 'dnsWatch',
		icon: 'file:dnsWatch.svg',
		group: ['trigger'],
		version: [1],
		description: 'Watch for DNS record changes by polling',
		defaults: {
			name: 'DNS Watch',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		return null;
	}
}
