# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog and the project uses semantic versioning.

## [v0.1.1] - 2026-04-02

### Added

- release and CI badges at the top of the README
- a first project changelog for future releases
- selector profiles in `share-inject.js` so the injected button logic can adapt to different AList row layouts

### Changed

- upgraded the injected frontend logic from a single selector path to a profile-based strategy
- improved button placement heuristics by separating row selection, file-name extraction, and button anchoring rules

## [v0.1.0] - 2026-04-02

### Added

- initial public release of the AList Share Sidecar
- environment-only configuration with no embedded secrets
- PHP sidecar endpoints for share creation, download gating, and SQLite storage
- signed AList `/d/...?...sign=...` download redirect support
- example nginx and `customize_body` snippets
- visual README assets and a short demo animation
- CI with PHP lint and Gitleaks
