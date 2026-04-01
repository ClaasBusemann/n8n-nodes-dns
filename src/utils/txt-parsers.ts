export interface SpfMechanism {
	qualifier: string;
	type: string;
	value: string | null;
}

export interface SpfParsed {
	type: 'spf';
	version: string;
	mechanisms: SpfMechanism[];
}

export interface DmarcParsed {
	type: 'dmarc';
	version: string;
	policy: string;
	subdomainPolicy: string | null;
	percentage: number;
	reportAggregate: string[];
	reportForensic: string[];
	alignmentDkim: string;
	alignmentSpf: string;
}

export interface DkimParsed {
	type: 'dkim';
	version: string;
	keyType: string;
	publicKey: string;
	hashAlgorithms: string[];
	serviceTypes: string[];
	flags: string[];
}

export interface VerificationParsed {
	type: 'verification';
	provider: string;
	token: string;
}

export type TxtParsed = SpfParsed | DmarcParsed | DkimParsed | VerificationParsed;

type TxtParseResult = { parsed: TxtParsed } | { parsed: null; parseError: string };

type TxtDetector = (raw: string) => TxtParseResult | null;

const SPF_QUALIFIERS = new Set(['+', '-', '~', '?']);

const SPF_MECHANISM_TYPES = new Set([
	'ip4',
	'ip6',
	'include',
	'a',
	'mx',
	'all',
	'redirect',
	'exists',
]);

const DMARC_ALIGNMENT_MAP: Record<string, string> = {
	r: 'relaxed',
	s: 'strict',
};

function parseSpfToken(token: string): SpfMechanism | null {
	let qualifier = '+';
	let remainder = token;
	const firstChar = remainder.charAt(0);

	if (SPF_QUALIFIERS.has(firstChar)) {
		qualifier = firstChar;
		remainder = remainder.slice(1);
	}

	if (remainder.startsWith('redirect=')) {
		return { qualifier, type: 'redirect', value: remainder.slice('redirect='.length) };
	}

	const colonIndex = remainder.indexOf(':');
	let mechanismType: string;
	let value: string | null;

	if (colonIndex !== -1) {
		mechanismType = remainder.slice(0, colonIndex);
		value = remainder.slice(colonIndex + 1);
	} else {
		mechanismType = remainder;
		value = null;
	}

	if (!SPF_MECHANISM_TYPES.has(mechanismType)) {
		return null;
	}

	return { qualifier, type: mechanismType, value };
}

function detectSpf(raw: string): TxtParseResult | null {
	if (!raw.startsWith('v=spf1') || (raw.length > 6 && raw[6] !== ' ')) {
		return null;
	}

	const body = raw.slice(6).trim();
	if (body === '') {
		return { parsed: { type: 'spf', version: 'spf1', mechanisms: [] } };
	}

	const tokens = body.split(/\s+/);
	const mechanisms: SpfMechanism[] = [];

	for (const token of tokens) {
		const mechanism = parseSpfToken(token);
		if (mechanism === null) {
			return { parsed: null, parseError: `Unrecognized SPF mechanism: ${token}` };
		}
		mechanisms.push(mechanism);
	}

	return { parsed: { type: 'spf', version: 'spf1', mechanisms } };
}

function parseTagValue(pair: string): { tag: string; value: string } | null {
	const equalsIndex = pair.indexOf('=');
	if (equalsIndex === -1) {
		return null;
	}
	return {
		tag: pair.slice(0, equalsIndex).trim(),
		value: pair.slice(equalsIndex + 1).trim(),
	};
}

function splitUriList(value: string): string[] {
	return value.split(',').map((uri) => uri.trim());
}

function resolveAlignment(value: string | undefined): string {
	if (value === undefined) {
		return 'relaxed';
	}
	return DMARC_ALIGNMENT_MAP[value] ?? 'relaxed';
}

function detectDmarc(raw: string): TxtParseResult | null {
	if (!raw.startsWith('v=DMARC1') || (raw.length > 8 && raw[8] !== ';' && raw[8] !== ' ')) {
		return null;
	}

	const pairs = raw.split(';').slice(1);
	const tags = new Map<string, string>();

	for (const pair of pairs) {
		const trimmed = pair.trim();
		if (trimmed === '') {
			continue;
		}
		const parsed = parseTagValue(trimmed);
		if (parsed !== null) {
			tags.set(parsed.tag, parsed.value);
		}
	}

	const policy = tags.get('p');
	if (policy === undefined) {
		return { parsed: null, parseError: 'DMARC record missing required p (policy) tag' };
	}

	const rawPercentage = tags.get('pct');
	let percentage = 100;
	if (rawPercentage !== undefined) {
		percentage = parseInt(rawPercentage, 10);
		if (isNaN(percentage)) {
			return {
				parsed: null,
				parseError: `DMARC pct tag is not a valid number: ${rawPercentage}`,
			};
		}
	}

	return {
		parsed: {
			type: 'dmarc',
			version: 'DMARC1',
			policy,
			subdomainPolicy: tags.get('sp') ?? null,
			percentage,
			reportAggregate: tags.has('rua') ? splitUriList(tags.get('rua')!) : [],
			reportForensic: tags.has('ruf') ? splitUriList(tags.get('ruf')!) : [],
			alignmentDkim: resolveAlignment(tags.get('adkim')),
			alignmentSpf: resolveAlignment(tags.get('aspf')),
		},
	};
}

function splitColonList(value: string): string[] {
	return value.split(':').map((item) => item.trim());
}

function detectDkim(raw: string): TxtParseResult | null {
	if (!raw.startsWith('v=DKIM1') || (raw.length > 7 && raw[7] !== ';' && raw[7] !== ' ')) {
		return null;
	}

	const pairs = raw.split(';').slice(1);
	const tags = new Map<string, string>();

	for (const pair of pairs) {
		const trimmed = pair.trim();
		if (trimmed === '') {
			continue;
		}
		const parsed = parseTagValue(trimmed);
		if (parsed !== null) {
			tags.set(parsed.tag, parsed.value);
		}
	}

	const publicKey = tags.get('p');
	if (publicKey === undefined) {
		return { parsed: null, parseError: 'DKIM record missing required p (public key) tag' };
	}

	return {
		parsed: {
			type: 'dkim',
			version: 'DKIM1',
			keyType: tags.get('k') ?? 'rsa',
			publicKey: publicKey.replace(/\s+/g, ''),
			hashAlgorithms: tags.has('h') ? splitColonList(tags.get('h')!) : ['sha256'],
			serviceTypes: tags.has('s') ? splitColonList(tags.get('s')!) : ['*'],
			flags: tags.has('t') ? splitColonList(tags.get('t')!) : [],
		},
	};
}

const VERIFICATION_PREFIXES: ReadonlyArray<{ prefix: string; provider: string }> = [
	{ prefix: 'google-site-verification=', provider: 'google' },
	{ prefix: 'facebook-domain-verification=', provider: 'facebook' },
	{ prefix: 'MS=', provider: 'microsoft' },
	{ prefix: 'atlassian-domain-verification=', provider: 'atlassian' },
	{ prefix: 'apple-domain-verification=', provider: 'apple' },
	{ prefix: '_github-pages-challenge-', provider: 'github' },
	{ prefix: 'stripe-verification=', provider: 'stripe' },
	{ prefix: 'postmark-verification=', provider: 'postmark' },
];

function detectVerification(raw: string): TxtParseResult | null {
	for (const { prefix, provider } of VERIFICATION_PREFIXES) {
		if (raw.startsWith(prefix)) {
			return {
				parsed: {
					type: 'verification',
					provider,
					token: raw.slice(prefix.length),
				},
			};
		}
	}
	return null;
}

const TXT_DETECTORS: TxtDetector[] = [detectSpf, detectDmarc, detectDkim, detectVerification];

export function enrichTxtRecord(raw: string): { parsed: TxtParsed | null; parseError?: string } {
	for (const detector of TXT_DETECTORS) {
		const result = detector(raw);
		if (result !== null) {
			if (result.parsed !== null) {
				return { parsed: result.parsed };
			}
			return { parsed: null, parseError: (result as { parseError: string }).parseError };
		}
	}
	return { parsed: null };
}
