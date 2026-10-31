# Scrutinizer v2.8.2: Page loads

**Date:** 2026-10-31
**Previous:** [v2.8.1](release_notes_v2.8.1.md)

The foveated view now stays up while you interact with a page.

## Fixed

- The foveated view no longer drops out for a moment when a page loads, when part of a page loads on its own (such as a video preview on hover), or when a results tab is switched.
- Scrolling panes stay aligned with the view when the computer is busy.
- Fixed and sticky elements and the structure maps update after a jump scroll that lands while the page is changing.

## Testing

`npm run check:scroll`, the release gate for the foveated HUD, also runs six interaction checks (hover, embedded frames, expanding sections, tabs, typing, navigation) and fails if the unfoveated page shows through at any point.

## Download

macOS (Apple Silicon): [Scrutinizer-2.8.2-arm64.dmg](https://github.com/andyed/scrutinizer2025/releases/download/v2.8.2/Scrutinizer-2.8.2-arm64.dmg)
