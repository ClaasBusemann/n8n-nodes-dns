import { enrichTxtRecord } from '../../src/utils/txt-parsers';

describe('enrichTxtRecord', () => {
	describe('SPF records', () => {
		it('should parse the design doc example exactly', () => {
			const result = enrichTxtRecord('v=spf1 ip4:192.0.2.0/24 include:_spf.google.com -all');
			expect(result).toEqual({
				parsed: {
					type: 'spf',
					version: 'spf1',
					mechanisms: [
						{ qualifier: '+', type: 'ip4', value: '192.0.2.0/24' },
						{ qualifier: '+', type: 'include', value: '_spf.google.com' },
						{ qualifier: '-', type: 'all', value: null },
					],
				},
			});
		});

		it('should default qualifier to + when omitted', () => {
			const result = enrichTxtRecord('v=spf1 ip4:10.0.0.0/8');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'ip4', value: '10.0.0.0/8' }],
			});
		});

		it('should parse explicit + qualifier', () => {
			const result = enrichTxtRecord('v=spf1 +ip4:10.0.0.0/8');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'ip4', value: '10.0.0.0/8' }],
			});
		});

		it('should parse - qualifier (fail)', () => {
			const result = enrichTxtRecord('v=spf1 -all');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '-', type: 'all', value: null }],
			});
		});

		it('should parse ~ qualifier (softfail)', () => {
			const result = enrichTxtRecord('v=spf1 ~all');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '~', type: 'all', value: null }],
			});
		});

		it('should parse ? qualifier (neutral)', () => {
			const result = enrichTxtRecord('v=spf1 ?all');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '?', type: 'all', value: null }],
			});
		});

		it('should parse ip6 mechanism', () => {
			const result = enrichTxtRecord('v=spf1 ip6:2001:db8::/32');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'ip6', value: '2001:db8::/32' }],
			});
		});

		it('should parse include mechanism', () => {
			const result = enrichTxtRecord('v=spf1 include:_spf.google.com');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'include', value: '_spf.google.com' }],
			});
		});

		it('should parse bare a mechanism with value null', () => {
			const result = enrichTxtRecord('v=spf1 a');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'a', value: null }],
			});
		});

		it('should parse a mechanism with domain', () => {
			const result = enrichTxtRecord('v=spf1 a:example.com');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'a', value: 'example.com' }],
			});
		});

		it('should parse bare mx mechanism with value null', () => {
			const result = enrichTxtRecord('v=spf1 mx');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'mx', value: null }],
			});
		});

		it('should parse mx mechanism with domain', () => {
			const result = enrichTxtRecord('v=spf1 mx:example.com');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'mx', value: 'example.com' }],
			});
		});

		it('should parse redirect modifier', () => {
			const result = enrichTxtRecord('v=spf1 redirect=_spf.example.com');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'redirect', value: '_spf.example.com' }],
			});
		});

		it('should parse exists mechanism', () => {
			const result = enrichTxtRecord('v=spf1 exists:%{i}.spf.example.com');
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [{ qualifier: '+', type: 'exists', value: '%{i}.spf.example.com' }],
			});
		});

		it('should parse multiple mechanisms in a single record', () => {
			const result = enrichTxtRecord(
				'v=spf1 +ip4:10.0.0.0/8 ip6:fd00::/8 include:spf.protection.outlook.com ~all',
			);
			expect(result.parsed).toEqual({
				type: 'spf',
				version: 'spf1',
				mechanisms: [
					{ qualifier: '+', type: 'ip4', value: '10.0.0.0/8' },
					{ qualifier: '+', type: 'ip6', value: 'fd00::/8' },
					{ qualifier: '+', type: 'include', value: 'spf.protection.outlook.com' },
					{ qualifier: '~', type: 'all', value: null },
				],
			});
		});

		it('should parse v=spf1 alone as valid with empty mechanisms', () => {
			const result = enrichTxtRecord('v=spf1');
			expect(result).toEqual({
				parsed: {
					type: 'spf',
					version: 'spf1',
					mechanisms: [],
				},
			});
		});

		it('should return parseError for malformed SPF', () => {
			const result = enrichTxtRecord('v=spf1 !!!invalid @#$garbage');
			expect(result.parsed).toBeNull();
			expect(result.parseError).toEqual(expect.any(String));
		});
	});

	describe('DMARC records', () => {
		it('should parse the design doc example exactly', () => {
			const result = enrichTxtRecord('v=DMARC1; p=reject; rua=mailto:dmarc@example.com; pct=100');
			expect(result).toEqual({
				parsed: {
					type: 'dmarc',
					version: 'DMARC1',
					policy: 'reject',
					subdomainPolicy: null,
					percentage: 100,
					reportAggregate: ['mailto:dmarc@example.com'],
					reportForensic: [],
					alignmentDkim: 'relaxed',
					alignmentSpf: 'relaxed',
				},
			});
		});

		it('should fill RFC 7489 defaults for missing optional tags', () => {
			const result = enrichTxtRecord('v=DMARC1; p=none');
			expect(result.parsed).toEqual({
				type: 'dmarc',
				version: 'DMARC1',
				policy: 'none',
				subdomainPolicy: null,
				percentage: 100,
				reportAggregate: [],
				reportForensic: [],
				alignmentDkim: 'relaxed',
				alignmentSpf: 'relaxed',
			});
		});

		it('should parse all tags', () => {
			const result = enrichTxtRecord(
				'v=DMARC1; p=quarantine; sp=reject; rua=mailto:a@ex.com; ruf=mailto:f@ex.com; adkim=s; aspf=s; pct=50',
			);
			expect(result.parsed).toEqual({
				type: 'dmarc',
				version: 'DMARC1',
				policy: 'quarantine',
				subdomainPolicy: 'reject',
				percentage: 50,
				reportAggregate: ['mailto:a@ex.com'],
				reportForensic: ['mailto:f@ex.com'],
				alignmentDkim: 'strict',
				alignmentSpf: 'strict',
			});
		});

		it('should parse multiple rua URIs separated by commas', () => {
			const result = enrichTxtRecord('v=DMARC1; p=reject; rua=mailto:a@ex.com,mailto:b@ex.com');
			expect(result.parsed).toEqual(
				expect.objectContaining({
					reportAggregate: ['mailto:a@ex.com', 'mailto:b@ex.com'],
				}),
			);
		});

		it('should parse multiple ruf URIs separated by commas', () => {
			const result = enrichTxtRecord('v=DMARC1; p=reject; ruf=mailto:f1@ex.com,mailto:f2@ex.com');
			expect(result.parsed).toEqual(
				expect.objectContaining({
					reportForensic: ['mailto:f1@ex.com', 'mailto:f2@ex.com'],
				}),
			);
		});

		it('should parse strict adkim alignment', () => {
			const result = enrichTxtRecord('v=DMARC1; p=reject; adkim=s');
			expect(result.parsed).toEqual(expect.objectContaining({ alignmentDkim: 'strict' }));
		});

		it('should parse strict aspf alignment', () => {
			const result = enrichTxtRecord('v=DMARC1; p=reject; aspf=s');
			expect(result.parsed).toEqual(expect.objectContaining({ alignmentSpf: 'strict' }));
		});

		it('should parse subdomain policy', () => {
			const result = enrichTxtRecord('v=DMARC1; p=reject; sp=quarantine');
			expect(result.parsed).toEqual(expect.objectContaining({ subdomainPolicy: 'quarantine' }));
		});

		it('should parse percentage as integer', () => {
			const result = enrichTxtRecord('v=DMARC1; p=reject; pct=75');
			expect(result.parsed).toEqual(expect.objectContaining({ percentage: 75 }));
		});

		it('should return parseError for DMARC missing required p tag', () => {
			const result = enrichTxtRecord('v=DMARC1; rua=mailto:a@ex.com');
			expect(result.parsed).toBeNull();
			expect(result.parseError).toEqual(expect.any(String));
		});

		it('should return parseError for DMARC with non-numeric pct', () => {
			const result = enrichTxtRecord('v=DMARC1; p=reject; pct=abc');
			expect(result.parsed).toBeNull();
			expect(result.parseError).toEqual(expect.any(String));
		});
	});

	describe('unrecognized TXT records', () => {
		it('should return parsed: null for arbitrary text', () => {
			const result = enrichTxtRecord('some random text');
			expect(result).toEqual({ parsed: null });
		});

		it('should return parsed: null for empty string', () => {
			const result = enrichTxtRecord('');
			expect(result).toEqual({ parsed: null });
		});

		it('should not have parseError for unrecognized records', () => {
			const result = enrichTxtRecord('google-site-verification=abc123');
			expect(result).toEqual({ parsed: null });
			expect(result).not.toHaveProperty('parseError');
		});
	});

	describe('detection chain', () => {
		it('should detect SPF before DMARC', () => {
			const result = enrichTxtRecord('v=spf1 -all');
			expect(result.parsed).toEqual(expect.objectContaining({ type: 'spf' }));
		});

		it('should detect DMARC when not SPF', () => {
			const result = enrichTxtRecord('v=DMARC1; p=none');
			expect(result.parsed).toEqual(expect.objectContaining({ type: 'dmarc' }));
		});

		it('should return null parsed when no detector matches', () => {
			const result = enrichTxtRecord('not-a-known-format');
			expect(result.parsed).toBeNull();
			expect(result).not.toHaveProperty('parseError');
		});
	});
});
