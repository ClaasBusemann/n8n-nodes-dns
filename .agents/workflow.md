# Workflow

## How to work on this project
When asked to build or update a node in this project, follow these steps:

1. Clarify the requirements. Ask for (if not already provided):
   - Which resources and operations the node needs to have
   - The authentication method (API key, OAuth2, etc)
   - Example use case or sample payloads, if available
   Do this **only** if there are multiple options **after** gathering
   information and you are not sure which to pick
2. Decide on the node style (declarative vs programmatic):
   - Prefer declarative-style nodes when:
     - The integration is mostly simple HTTP/REST requests and responses
     - You can express this behavior by mapping parameters to
       URL/query/body/headers
   - Use programmatic-style nodes only when you have at least one of:
     - Multiple dependent API calls are needed per execution
     - Complex control flow or aggregation
     - Responses require heavy transformation that can't be described
       declaratively
   - If you choose programmatic-style, briefly explain **why**
     declarative-style won't work for this particular node
3. Plan before coding:
   - Outline what description the node will have, its resources and
     operations
   - Which credentials the node will use and their properties
   - Confirm the plan, if you are not given one and are generating it
   - **Never start coding without a plan**
4. Implement. Create or update:
   - The node files (`src/nodes/<n>/<n>.node.ts`)
   - The credentials files (`src/credentials/<n>.credentials.ts`)
   - Other files with helpers and extracted functions/classes
   - `package.json` (`n8n.nodes` and `n8n.credentials` entries)
5. Quality checks — **zero errors, zero warnings, zero failing tests**:
   - `just build` — ensure the project compiles cleanly
   - `just lint` — no lint errors **or warnings**; fix all of them
   - `just test-all` — **all** tests must pass (unit, integration, **and
     e2e**). Always run this after implementation, before committing.
   - `just test-coverage` — tests pass AND meet coverage thresholds
   - `just format-check` — code must be formatted
   - `just verify` — package verification must pass with **no errors or
     warnings**. Always run this before committing.
   - Ensure UX follows the [n8n UX guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/)
   - Ensure the credentials are secure (sensitive values **are marked as
     `password`**, **no secrets logged** and **there aren't any
     hardcoded secrets**)
   - Run `just dev` so that the user can manually verify that it works.
     Ask the user on how to run it, and if something goes wrong tell
     them to run it themselves
   - Before considering any task done, run `just check` (the full
     pre-publish gate: lint + format-check + test-coverage + build +
     verify) **and** `just test-all` and confirm everything passes with
     **zero issues**
6. Iterate on the code, if needed, going through the process again:
   - Plan
   - Implement
   - Verify

## Development guidelines
- **Use `just` recipes** as the primary way to run builds, tests, linting, and
  verification. The `justfile` is the single source of truth for how to build,
  test, and verify the node locally. Run `just --list` to see all available
  recipes.
- Use the `n8n-node` CLI tool **whenever possible**, so for stuff like building
  a node, using dev mode with hot-reload linting, etc. Using this tool is the
  best way to make sure the code is of high quality and complies with n8n's
  standards
- **Zero tolerance for errors and warnings.** All lint errors, lint warnings,
  typecheck errors, and failing tests must be resolved before a task is
  considered done. Do not ignore or suppress them unless there is a **very
  specific, documented reason**. Run `just check` as the final gate.
- Before making any changes to the code, make sure you've gathered all required
  context and **planned out** what you're going to do. If the plan looks good,
  make sure to stick to it to ensure the code you produce is doing what the
  user expects
- After making changes run `just lint`, `just test-all`, `just format-check`,
  and `just verify` to verify there are no issues. All tests (unit, integration,
  and e2e) must be green and verification must pass with zero errors/warnings
  before committing. Also allow the user to manually test the node in n8n
  (via `just dev`) to verify that it does what is expected
- Make sure to use **proper types whenever possible**
- If you are updating the npm package version, make sure to **update
  CHANGELOG.md** in the root of the repository

## CLI
This project uses n8n's CLI tool for developing community nodes: `n8n-node`. It
is available as a dev dependency and `package.json` has some aliases for common
commands. Short overview of the commands:
- `n8n-node dev` - run n8n with your node in development mode with hot reload.
  This command starts up n8n on `http://localhost:5678` so that the user can
  manually test the node. It also links it to n8n's custom nodes directory
  (`~/.n8n-node-cli/.n8n/custom` by default), so it's available within n8n.
  `--external-n8n` makes it not launch n8n and `--custom-user-folder <path>`
  can be used to specify the folder where user-specific data is stored
  (`~/.n8n-node-cli` is the default)
- `n8n-node build` - compile your node and prepare it for distribution.
- `n8n-node lint` - lint the node in the current directory.
  Use `--fix` flag to automatically fix fixable issues.
- `n8n-node cloud-support` - manage n8n Cloud eligibility.
  If invoked without arguments, show current cloud support status. Invoke
  `n8n-node cloud-support enable` to enable strict mode + default ESLint config
  or `n8n-node cloud-support disable` to allow custom ESLint config (disables
  cloud eligibility)
- `n8n-node release` - publish your community node package to npm.
  This command handles the complete release process using `release-it`:
  - Builds the node
  - Runs linting checks
  - Updates changelog
  - Creates git tags
  - Creates GitHub releases
  - Publishes to npm
