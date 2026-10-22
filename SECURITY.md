# Security policy

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting:
**[Report a vulnerability](https://github.com/lokidata/enshrouded-map/security/advisories/new)** (Security tab of this repository). You will get an answer within a few days, and a fix and advisory once the problem is confirmed.

## Supported versions

Only the latest release (and `main`) receives security fixes.

## What is in place

- Authentication: Argon2id passwords, opaque server-side sessions, CSRF double-submit, rate limiting and progressive lockout.
- Accounts: the first account needs a setup code; later accounts only through single-use, 20-minute invitation links.
- Containers: non-root, read-only filesystems, dropped capabilities, internal API network, images scanned (Trivy) and signed (cosign).
- Supply chain: pinned base images and GitHub Actions, hash-checked Python dependencies, Dependabot, CodeQL, dependency review, secret scanning.
