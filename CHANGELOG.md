# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository documents, contributor templates, and the local pairing protocol notes.
- Tauri host that pairs a phone, stores validated images, notifies, and purges history from settings.
- Phone UI for one destination, crop, arrow, text, and blur, plus the desktop history panel.
- iOS share extension sources and the script that reattaches them after `tauri ios init`.
- GitHub Actions builds a portable Windows executable, an unsigned iOS app for sideload testing, and an Ad Hoc iOS app once signing secrets are set.
