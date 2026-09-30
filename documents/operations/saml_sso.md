# SAML login: FDA in rapid, Keycloak in dev/prod

`start_server.py` automatically selects the identity provider:

| Startup | Identity provider | Test IdP service |
| --- | --- | --- |
| `--mode dev` | Keycloak | Started automatically |
| `--mode prod` | Keycloak | Started automatically |
| `--rapid` | FDA SSO | Not started; an old Docker Keycloak orphan is removed |

This applies to both Docker and HPC's rootless Apptainer runtime. The app's
`prod` mode still uses a **test** IdP. Keycloak has a single-node file database
and generated test credentials; it is not the institutional production IdP.

## Configuration

Copy `.env.template` to `.env` only for a new deployment; preserve an existing
`.env`. Fill the SAML section from the template. Never put private keys in Git.

### Local Docker

```
SSO_PUBLIC_ORIGIN=http://localhost:8841
KEYCLOAK_PUBLIC_URL=
KEYCLOAK_SP_ENTITY_ID=
```

Run `python start_server.py --runtime docker --mode dev --build`. Open
`http://localhost:8841/fdalabel-v3/` and select **Sign in with Test SSO (Keycloak)**.
Keycloak is at `http://localhost:8843`. The starter prints the credentials file
path (`data/keycloak/<profile>/credentials.json`). The default application test
login is **leihong / 1986414**, configurable through `KEYCLOAK_TEST_USERNAME` and
`KEYCLOAK_TEST_PASSWORD` in `.env`. These settings apply to local/HPC Keycloak
only and do not affect rapid/FDA SSO. The separate randomly generated admin
credentials open Keycloak's console in the `master` realm; `sso-admin` is not an
application login in the `askfdalabel` realm.
Keep the same browser hostname throughout login (do not alternate localhost and
127.0.0.1). No FDA registration or FDA account is needed.

### HPC

Docker `--mode prod` now derives its default public host from `API_SERVER_HOST`
(falling back to `NEXT_PUBLIC_API_SERVER_HOST`). A matching `NEXT_PUBLIC_WIDGET_HOST`
provides the public scheme and port, including upstream HTTPS termination.
With the repository's HPC settings this produces `https://ncshpcgpu01.fda.gov`
and Keycloak at `https://ncshpcgpu01.fda.gov/sso`. Docker dev keeps localhost by
default. An explicit `SSO_PUBLIC_ORIGIN` always overrides those Keycloak defaults;
remove a leftover localhost override when deploying to HPC.

Set the origin to the exact address used by browsers, for example:

```
SSO_PUBLIC_ORIGIN=https://ncshpcgpu01.fda.gov
KEYCLOAK_PUBLIC_URL=
KEYCLOAK_SP_ENTITY_ID=
```

Run `python start_server.py --runtime apptainer --mode prod --build` (or Docker
on hosts using that runtime). With the bundled nginx, Keycloak is served at
`<origin>/sso`. Apptainer listens on HTTP 8080 / HTTPS 8443, so an origin without
a port requires an upstream proxy forwarding to those ports. Alternatively set
the origin to `https://ncshpcgpu01.fda.gov:8443` when visiting nginx directly.
Configure trusted TLS certificates under `deploy/nginx/cert.pem` and `key.pem`,
or terminate TLS at the upstream proxy. The upstream must preserve Host and
X-Forwarded-Proto and forward both the app/API paths and `/sso/`.

Without nginx (`--mode dev`), the default Keycloak address is
`http://<app-host>:8843`; Docker publishes that port and Apptainer listens on
host port 8843. If an HPC proxy provides the browser-facing address instead, set
`KEYCLOAK_PUBLIC_URL` to that address and preserve its configured path. Do not expose the app at
an HPC address while leaving the IdP hostname set to localhost.

After correcting an old localhost deployment, run the startup command again with
`--build`. Docker recreates services with the corrected URLs and selects a new
Keycloak profile, so use the credentials path printed by this startup (the old
profile and its data are preserved). Start a fresh login from the HPC URL;
previous AuthnRequests cannot be reused. If ACS still reports failure, inspect
the backend's `SAML validation failed` log for the toolkit's validation reason;
the public error remains generic and SAML XML is not logged.

If the log says `The Assertion must include an AuthnStatement element`, enable
**Include AuthnStatement** in Keycloak's `askfdalabel` realm, on the application's
SAML client under **SAML capabilities**, and save. Start a fresh login after
changing it; refreshing the failed POST reuses an already-consumed request.
The generated client explicitly sets `saml.authnstatement=true`.
Realm template revisions select a new profile because Keycloak skips startup
imports for an existing realm. Restarting Docker with the corrected code uses
the new profile and generated credentials; old profiles and their data remain.
To keep existing Keycloak users/passwords, enable the option in the existing
realm through its admin console instead of switching profiles.

Docker uses private named volumes for Keycloak's file DB; Apptainer uses
`data/keycloak/<profile>/db`. URL configurations get distinct profiles to avoid
reusing a realm import with stale ACS URLs. Repeated startup with the same
configuration preserves accounts and signing keys. If changing SSO configuration
on Apptainer, stop the old stack with `--down` before starting again; running
instances otherwise retain their original environment. `--down` keeps IdP data.

Changing either test credential selects a new profile on the next startup, so
Keycloak imports the requested account rather than skipping an existing realm.
Old profiles and their users remain stored. Use the credentials path printed by
the current startup; after a profile change, passwords from older profiles do
not apply. For Docker, rerun the startup command to recreate the container with
its new volume. For Apptainer, stop the old instances before starting again.

### FDA / rapid

The examples record this pre-prod SP registration, now populated in both templates:

```
FDA_SAML_ENTITY_ID=https://askfdalabel-nctr.preprod.fda.gov
FDA_SAML_ACS_URL=https://askfdalabel-nctr.preprod.fda.gov/api/auth/saml
FDA_SAML_ACS_PATH=/api/auth/saml
```

`FDA_SAML_ACS_PATH` is the Flask route **after** the proxy strips the external
prefix. If the registered ACS uses another path, configure that route and ensure
the upstream sends its POST to Flask. These registered values are required for
actual rapid startup; `--dry-run` warns about missing values and remains usable.
Rapid derives its public origin from the registered ACS URL; `SSO_PUBLIC_ORIGIN`
remains a local/HPC Keycloak setting. The FDA ACS must use HTTPS. Next's existing
base-path-independent `/api/:path*` rewrite forwards the registered callback to
Flask in rapid mode. Bundled nginx also forwards `/api/auth/saml` directly to
Flask when nginx is used. The pre-prod upstream must pass this POST through.

The backend reads the repository's `deploy/SSO_config/sso2.xml` from `/deploy`.
Its IdP issuer is `http://sso2.fda.gov`; preserve this identifier exactly. The
metadata must come from a trusted FDA channel. Verify certificate updates through
that channel; merely parsing a signed XML file does not authenticate its origin.
If required, set **both** `SAML_SP_CERT_FILE` and `SAML_SP_KEY_FILE` to backend
container paths for SP signing/decryption. `/deploy` is mounted in both runtimes.

Rapid uses prebuilt images: build/package the changed backend and frontend before
deploying them. Existing images do not gain SAML support from `.env` alone.
The SAML toolkit and XML security libraries are in Docker/Apptainer build files.

## Flow and accounts

- Browser navigation to `/api/dashboard/auth/saml/login` creates a five-minute
  request in shared Redis and an opaque browser flow marker in Flask's session.
- IdP returns a signed assertion by POST to ACS. Signature, issuer, audience,
  destination, timestamps and request correlation are checked in strict mode.
  Unsolicited/IdP-initiated login is not accepted. The IdP must sign the assertion;
  Keycloak is preconfigured to sign both response and assertion.
- ACS consumes the request and rejects previously used response/assertion IDs
  atomically. It writes no Flask session cookie. It issues a 303 to a short-lived,
  one-use completion endpoint on the configured application origin.
- The resulting GET receives the browser's existing `SameSite=Lax` session cookie.
  Only the browser which initiated login can complete it. The session is cleared
  before `login_user()` establishes the authenticated app session. HTTP localhost
  works without weakening the application cookie to `SameSite=None`.

`SsoIdentity` is a new public-schema table, created by the existing startup
`db.create_all()` process. Accounts bind to **IdP issuer + NameID**, never to
matching email or display name. FDA must confirm NameID is stable across logins
(metadata's `unspecified` format alone does not promise this). Email is required;
Name and Office Info are optional profile data. New SSO users get role `user`.
Admins can change roles in the existing management panel. Existing local accounts,
their projects and passwords remain separate; no automatic account merging occurs.
SSO accounts cannot log in or set/reset a local password. Deactivated accounts
cannot complete SSO login. The header displays the IdP's Name when present.

App logout clears only the app session. FDA metadata has no Single Logout service;
the next login can reuse an existing IdP session. Existing password/guest login is
retained; this change does not mandate SSO-only access.

## Deployment acceptance

1. Generate dev/prod/rapid configurations and validate Docker YAML with
   `docker compose config --quiet` (do not print expanded secrets).
2. Start the local/HPC stack; wait for Keycloak's realm import to finish. Login
   before Keycloak is ready returns 503 and can be retried. Verify signed login,
   browser return, refresh, role permissions, logout and repeat login.
3. Check failures: wrong audience/destination/request ID, expiry, missing Email,
   altered signature, replay, a completion link opened in another browser, and a
   deactivated account. Redis must remain available; SAML fails closed otherwise.
4. In pre-prod, validate the registered ACS routing through the actual upstream
   proxy, real FDA attributes and stable NameID, signing/encryption requirements,
   login/session behavior and repeat login with a real FDA account.

The one-off implementation verification used real signed SAML XML against the
Flask SAML routes, an isolated SQLite database and a Redis-compatible test store.
This is not a replacement for live Keycloak and FDA browser acceptance.
