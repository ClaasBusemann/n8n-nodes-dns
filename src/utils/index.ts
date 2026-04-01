export const DNS_MAX_NAME_LENGTH = 253;
export { decompressName, type DecompressedName } from './name-compression';
export { walkDelegationChain } from './authoritative-discovery';
export type { QueryFunction, WalkDelegationChainOptions } from './authoritative-discovery';
export { parseRdata } from './record-parsers';
export type {
	RecordValue,
	MxRecordValue,
	TxtRecordValue,
	SrvRecordValue,
	SoaRecordValue,
	CaaRecordValue,
	NaptrRecordValue,
	DnskeyRecordValue,
	TlsaRecordValue,
} from './record-parsers';
export { enrichTxtRecord } from './txt-parsers';
export type { TxtParsed, SpfParsed, SpfMechanism, DmarcParsed } from './txt-parsers';
