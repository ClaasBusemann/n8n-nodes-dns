// verify.mjs — Local replica of @n8n/scan-community-package
//
// Packs the project, extracts the tarball, and runs the same ESLint rules
// that the n8n verification scanner would run against the published package.

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import plugin from '@n8n/eslint-plugin-community-nodes';
import fg from 'fast-glob';

// 1. Pack the project
const packOutput = execSync('npm pack --pack-destination .', {
	encoding: 'utf-8',
});
// npm pack may output lifecycle script output before the tarball name on the last line
const tarball = packOutput.trim().split('\n').pop().trim();
console.log(`Packed: ${tarball}`);

// 2. Extract to a temp directory
const tempDir = mkdtempSync(join(tmpdir(), 'n8n-verify-'));
try {
	execSync(`tar xzf "${tarball}" -C "${tempDir}"`, { stdio: 'pipe' });

	const extractedDir = join(tempDir, 'package');
	console.log(`Extracted to: ${extractedDir}`);

	// 3. Find all JS files in the extracted package
	const jsFiles = await fg('**/*.js', { cwd: extractedDir, absolute: true });
	if (jsFiles.length === 0) {
		console.error('No .js files found in tarball');
		process.exit(1);
	}
	console.log(`Found ${jsFiles.length} JS file(s) to lint`);

	// 4. Run ESLint with the scanner's config
	const eslint = new ESLint({
		cwd: extractedDir,
		overrideConfigFile: true,
		overrideConfig: [
			plugin.configs.recommendedWithoutN8nCloudSupport,
			{
				rules: {
					'no-console': 'error',
				},
			},
		],
	});

	const results = await eslint.lintFiles(jsFiles);

	// 5. Report results
	const formatter = await eslint.loadFormatter('stylish');
	const output = await formatter.format(results);

	const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
	const warningCount = results.reduce((sum, r) => sum + r.warningCount, 0);

	if (output) {
		console.log(output);
	}

	if (errorCount > 0) {
		console.error(`\nVerification FAILED: ${errorCount} error(s), ${warningCount} warning(s)`);
		process.exit(1);
	}

	if (warningCount > 0) {
		console.log(`\nVerification passed with ${warningCount} warning(s)`);
	} else {
		console.log('\nVerification passed: no errors or warnings');
	}
} finally {
	// Cleanup
	rmSync(tempDir, { recursive: true, force: true });
	rmSync(tarball, { force: true });
}
