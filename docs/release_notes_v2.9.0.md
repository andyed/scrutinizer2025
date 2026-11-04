# Scrutinizer v2.9.0: Capture fixes

**Date:** 2026-11-04
**Previous:** [v2.8.2](release_notes_v2.8.2.md)

## Fixed

- Recorded studies save every task on 2x (Retina) displays.
- Typing, focusing a field and submitting a form no longer move the recorded pointer.
- A tall page that hasn't changed is no longer saved twice in a recorded session.
- The foveated view stays aligned during scrolling when the graphics processor is busy.

## Changed

- A saved session's evidence is checked before analysis: pointer rows, timestamps, page captures and capture health.
- The study toolbar says whether a task is being recorded, and the completion screen says what was saved.

## Testing

`npm run check:study` runs a two-task recorded study in the app, at the display's own scale and at 1x, and checks the saved session. It is now a release gate alongside `check:scroll`.

## Download

macOS (Apple Silicon): [Scrutinizer-2.9.0-arm64.dmg](https://github.com/andyed/scrutinizer2025/releases/download/v2.9.0/Scrutinizer-2.9.0-arm64.dmg)
