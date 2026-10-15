# Isolated validation

Use Node.js 22 or later; the quality closeout used Node.js 24.11.0 on Windows. The container uses Node.js 24. Older Node 14/18 setup notes are superseded by this requirement. Install the locked dependencies with `npm ci`.

## Database and network boundary

The integration tests delete collections. Never point them at a personal, shared or production database, including an existing database whose name happens to contain "test".

Start a separate MongoDB process with a new empty data directory and a verified free loopback port. Record its PID/start time and check that the listener belongs to it. Do not use the existing MongoDB service or the port-killing/start-clean/seed/bootstrap scripts. An example process invocation, with paths/port chosen for that run, is:

```powershell
# The directory must be new and empty, and the chosen port must be free.
mongod --bind_ip 127.0.0.1 --port 59321 --dbpath <new-disposable-directory>
```

In the isolated source worktree, explicitly select a unique run database:

```powershell
$QualityDatabaseName = 'piqniq-test-' + [Guid]::NewGuid().ToString('N')
$env:NODE_ENV = 'test'
$env:MONGODB_URI_TEST = 'mongodb://127.0.0.1:59321/' + $QualityDatabaseName
$env:PIQNIQ_TEST_DB_ACK = $QualityDatabaseName
$env:ALLOW_SUPERADMIN_BOOTSTRAP = 'false'
npm test
```

Use the actual dedicated port in that URI. The acknowledgement is an explicit operator assertion of disposable ownership, not proof by itself. Verify the fresh process/data-directory boundary first.

Jest setup validates the explicit URI and matching database acknowledgement before importing tests, assigns that URI to MONGODB_URI, binds HTTP test listeners to loopback, and blocks non-loopback TCP connections. There is no fallback to piqniq or piqniq-test. Generated .tmp_* fixtures are excluded from test/coverage discovery. All three mail helpers skip delivery in test runtime; news tests mock RSS responses. Never copy a private .env file into a test fixture.

After validation, close only processes started for that run, drop only the explicitly owned disposable databases, and remove only verified run-owned uploads/data directories. Keep concise results; do not publish logs, credentials, cookies, tokens, environment files or account exports.

## Native and browser checks

For native checks, use a separate fresh database from the Jest database. Set HOST=127.0.0.1, a free PORT, PORT_TRIES=0, BASE_URL and ALLOWED_ORIGINS to that exact loopback origin, and disable administrator bootstrap. Run the actual entry point with `node app.js`; its normal first-run maintenance must operate only on that disposable database.

Disable outbound SMTP and other network side effects in the fixture. The closeout used a stream-only mail transport, a TCP allowlist, a fresh headless Edge context with non-loopback requests blocked, and an additional restrictive test CSP that prevented external fonts/images. These are test fixtures, not production mail-delivery or TLS evidence.

`npm run chat:smoke` requires the same explicit MONGODB_URI_TEST/database acknowledgement and a loopback BASE_URL for the running fixture. It creates a synthetic user, logs in for a real session cookie, exercises public/private room messaging and wrong-password rejection, then removes only its own user/rooms/messages. Do not run it against an existing live instance.

`npm run chat:ui` checks existing element IDs and either the static or same-origin dynamic Socket.IO loader. Browser tests should additionally exercise registration, verification, posting/rendering, profiles, private Study workspaces, portfolio gating, chat and logout, including unauthorised and invalid-input cases.

## Build and dependency checks

There is no npm build script. The supported image build is `npm run docker:build -- app`; building does not require starting containers. Do not run docker:up/down or deploy as part of validation. The Docker context excludes environment files, logs, uploads, coverage and temporary fixtures.

A production install uses `npm ci --omit=dev`. Jest, Supertest, nodemon and patch-package are development dependencies. The existing tr46 deprecation patch is retained and applied only when its local development tool is installed; production installs safely skip that cosmetic patch.

Run both `npm audit --omit=dev` and `npm audit`, reporting the production and development results separately. An unavailable Docker engine is a blocked image-build check, not a pass. Native Windows startup does not establish container, reverse-proxy, TLS or external SMTP correctness.

## Authentication and storage compatibility

Registration, login and email verification rotate session IDs and disconnect sockets associated with the replaced session. Both Socket.IO namespaces require the HTTP session, check its account/revocation version on incoming events, and periodically revalidate idle connections. Reset and account erasure revoke existing access; user sessionVersion defaults to zero for legacy records, so no bulk data migration is required.

Reset passwords are hashed exactly once. Reset and verification capabilities are consumed atomically. New/changed passwords must fit bcrypt's 72 UTF-8 byte limit; login retains the previous length allowance for existing hashes. Existing credentials are not rewritten or forcibly reset. Legacy long-password hashes retain their previous truncation behaviour until the user changes the password; any broader credential migration needs separate review.

Credential tokens are omitted from user responses and sensitive log paths/metadata. Chat downloads retain the existing authenticated capability-URL contract; this change does not introduce a new durable room membership model. Raster upload decoding/type checks and PDF signatures are validation, not antivirus/content-safety certification.

## Review correction checks — 2026-10-15

The Docker installation layer copies package.json, package-lock.json and scripts/apply-optional-patches.js before `npm ci --omit=dev`, then copies the application source. The container regression reconstructs the actual pre-install COPY instructions in a fresh temporary directory and executes the manifest's production postinstall without the application or development tooling. A separate fresh fixture ran actual locked `npm ci --omit=dev` with exactly that pre-source layout: 221 packages installed, lifecycle succeeded and Jest/jsdom/nodemon/patch-package/Supertest were absent. Source was copied only after that install for native production checks. These results establish the layer/lifecycle contract, not an Alpine image build: the actual `npm run docker:build -- app` was attempted again and remains blocked by the unavailable Docker Desktop Linux engine. Container acceptance must remain pending until an available authorised engine builds the image; no daemon/services were started to bypass that limit.

Client regressions use development-only jsdom 26.1.0, compatible with the supported runtime, to execute the real ProfileManager helper and parse its rendered HTML. They do not replace escapeHtml. Hostile legacy quotation marks in all three social fields must remain one input value, with exactly the intended attribute names and no injected elements. The public avatar alt attribute, biography text and executable URL rejection are also checked. Browser observations repeat the legacy-value case using a synthetic account and the actual Edge DOM; new hostile URLs are rejected by the API and blank links still save. jsdom does not execute embedded hostile scripts or fetch external resources. It is omitted from production installs.

Login retains its original absence of a credential-length cap for existing/imported hashes; it still requires a non-empty string and remains subject to the application's request body and rate limits. Registration/reset/model-save keep the 72 UTF-8 byte policy. A synthetic imported hash with a password longer than 128 characters now logs in successfully, while a different prefix fails authentication. The test imports only that fixture hash; no existing credentials are migrated or weakened.

The review correction reproduced five Docker/DOM failures and one separate legacy-login failure before their respective fixes. Final full npm test: 115 passed, zero failed, one pre-existing skip; 17 suites. Fresh Edge checks passed 12 journey groups (including legacy profile attributes) with no pageerror events. Native production-only auth/session/reset/upload checks, legacy long-password success/wrong-password failure and development/production private/public chat smoke checks passed. All audit-owned services were stopped and the three new review databases cleared; ignored local artifact directories were retained without a new deletion attempt.

## Development advisory disposition — checked 2026-10-15

`npm audit --omit=dev` reports zero advisories. The full install reports 25 development-only advisory nodes (19 moderate, six high), propagated from **two root advisories**, not 25 distinct application flaws. `npm explain` and the lockfile establish these installed paths:

| Root advisory | Installed development path | Practical exposure and disposition |
| --- | --- | --- |
| [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high; braces 3.0.3 | nodemon 3.1.14 → chokidar 3.6.0 → braces 3.0.3; patch-package 8.0.1 → find-yarn-workspace-root 2.0.0 → micromatch 4.0.8 → braces 3.0.3 | Deeply nested glob patterns can stop the development tool. Watch/workspace patterns are operator/repository configuration here; no application HTTP handler imports these tools. Do not use unreviewed watch/workspace configuration or run development tooling in production. |
| [sprintf-js precision exhaustion](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), moderate; sprintf-js 1.0.3 | jest 30.5.2 → @jest/core 30.5.2 → @jest/transform 30.5.2 → babel-plugin-istanbul 8.0.2 → @istanbuljs/load-nyc-config 1.1.0 → js-yaml 3.15.2 → argparse 1.0.10 → sprintf-js 1.0.3 | Attacker-controlled formatting precision can exhaust development-process resources. This path formats test/CLI configuration/help, not application request bodies; source inspection shows fixed error formats and configurable help/usage formats. Review test/config changes and run untrusted work only in disposable jobs without secrets or privileged data. |

The reachability assessment is local source/dependency inspection, not a proof that development tools are safe for arbitrary untrusted repositories. The clean manifest-only production install omits both affected roots and their parent tools; the production audit independently reports zero. Both upstream advisories list no patched version at this review. The registry's latest braces (3.0.3) and sprintf-js (1.1.3) remain in the affected ranges. npm suggests major backward moves to nodemon 1.14.10, patch-package 6.0.7 and Jest 25.0.0; those are not accepted safe remediations and were not forced. Keep the advisory risk explicit for Aether's acceptance; adopt/retest a supported upstream fix when one exists rather than overriding a dependency incompatibly or removing required test coverage.

External SMTP delivery and real TLS/reverse-proxy acceptance remain unverified because this assignment deliberately uses stream-only mail and loopback HTTP. Broader browser/device acceptance is also pending; current observations cover one fresh Edge version at desktop/mobile viewport sizes. These are explicit acceptance limits for independent review, not passes or authorisation to deploy.
