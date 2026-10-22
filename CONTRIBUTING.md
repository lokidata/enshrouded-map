# Contributing

Thanks for your interest. `main` is protected: every change goes through a pull request that must pass the checks.

1. Fork or branch, then make your change. Keep it focused.
2. Run `make check` (and `make e2e-stack` if you touched the stack). Tests go with behavior changes.
3. Open a pull request with the template. Squash merge is the only merge method.

Rules of the house:

- Never commit secrets, tokens or game data (tiles, icons, extracted files). `artifacts/` is git-ignored on purpose.
- Security-sensitive changes (auth, sessions, nginx, Docker) need a short explanation in the PR.
- Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
