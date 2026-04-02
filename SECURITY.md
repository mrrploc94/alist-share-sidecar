# Security Policy

## Public repository rules

This repository is intended to stay safe for public hosting.

Do not commit:

- passwords
- API tokens
- server IP addresses
- private domains
- production database files
- logs containing user data

All runtime secrets must come from environment variables or an external secret manager.

## Deployment hardening

- Keep the sidecar behind HTTPS.
- Use an AList admin token with the smallest practical blast radius.
- Restrict write access to the SQLite database directory.
- Rotate admin credentials if a deployment host is ever exposed.
- Add repository secret scanning in CI and in your Git hosting provider.

## Reporting

Open a private security report through your Git hosting platform, or contact the project maintainer through a private channel before disclosing details publicly.
