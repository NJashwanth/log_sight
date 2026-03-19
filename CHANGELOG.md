# Changelog

## 1.0.2
- Fixed a webview script runtime issue that could leave the Log Sight panel empty.
- Fixed toolbar interactions (including capture Start/Stop) when the panel script failed to initialize.
- Hardened embedded script regex handling to avoid escape-related runtime breakage.

## 1.0.1
- Fixed a regression where the panel could appear empty and toolbar actions did not respond.
- Added re-entrancy protection around console mirroring to avoid recursive runtime failures.
- Improved log visibility by emitting non-warning and non-error output via info level.
- Restored mirroring for `console.log` and `console.info` calls.
- Replaced `Array.prototype.at` usage in duplicate collapsing for broader runtime compatibility.

## 1.0.0
- Added advanced filtering with source and time-range filters.
- Added regex search mode with invalid-pattern feedback.
- Added named filter presets in the panel.
- Added consecutive duplicate collapsing with count badges.
- Added source grouping toggle for easier log stream scanning.
- Added multiline expand/collapse support for stack traces.
- Added clickable file-path links (`path:line:column`) that open files directly in the editor.
- Added per-row copy actions and stack-trace copy action.

## 0.0.3
- Added start and stop controls for log capture in the Log Sight panel.
- Added Command Palette actions to pause and resume log capture.

## 0.0.1
- Initial release of Log Sight.
- Added a debug-console-style panel with timestamped logs.
- Added log-level filtering for debug and error messages.
