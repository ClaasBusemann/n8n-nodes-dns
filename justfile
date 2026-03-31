# justfile

# List all available recipes
default:
    @just --list

# ── Build ─────────────────────────────────────────────────────────────────────

# Compile TypeScript → dist/
build:
    npm run build

# Watch mode for development (starts local n8n instance with node loaded)
dev:
    npm run dev

# ── Code quality ──────────────────────────────────────────────────────────────

# Run n8n node linter
lint:
    npm run lint

# Run linter and auto-fix
lint-fix:
    npm run lint:fix

# Run Prettier formatter
format:
    npx prettier --write "src/**/*.ts" "test/**/*.ts"

# Check formatting without writing (for CI)
format-check:
    npx prettier --check "src/**/*.ts" "test/**/*.ts"

# ── Tests ─────────────────────────────────────────────────────────────────────

# Run unit tests only
test-unit:
    npx jest --testPathPatterns="test/unit"

# Run integration tests (requires network access)
test-int:
    RUN_INTEGRATION_TESTS=1 npx jest --testPathPatterns="test/integration"

# Run unit + integration (default CI suite)
test:
    npx jest --testPathPatterns="test/unit|test/integration"

# Run unit + integration tests with coverage enforcement
test-coverage:
    npx jest --testPathPatterns="test/unit|test/integration" --coverage

# Run e2e tests (requires network access)
test-e2e:
    RUN_INTEGRATION_TESTS=1 npx jest --testMatch="**/test/e2e/**/*.test.ts"

# Run all tests including e2e
test-all:
    RUN_INTEGRATION_TESTS=1 npx jest --testMatch="**/test/**/*.test.ts"

# ── Verification ──────────────────────────────────────────────────────────────

# Run @n8n/scan-community-package locally (local replica of verification gate)
verify:
    node verify.mjs

# Full pre-publish check: lint + format-check + test-coverage + build + verify
check: lint format-check test-coverage build verify
    @echo "All checks passed."
