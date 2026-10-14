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
