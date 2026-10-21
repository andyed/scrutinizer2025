# Scrutinizer v2.8.1: Scrolling

**Date:** 2026-10-20
**Previous:** [v2.8.0](release_notes_v2.8.0.md)

The foveated view now stays on the page while it scrolls.

## Fixed

- The foveated view no longer drops out while a page scrolls.

## Changed

- **The view stays aligned with the page during scroll.** Each frame is captured asynchronously, so a new one arrives a moment after the page moves. Between captures the last frame now moves with the page, and the fovea stays on the pointer. The strip the scroll uncovers at the leading edge shows a blurred extension of the frame until the next capture fills it.
- **Fixed and sticky elements hold still.** Headers, sidebars and tables of contents pinned to the viewport stay in place while the content scrolls under them.
- **Scrolling panes get the same treatment.** Pages that scroll an element instead of the window, such as mail and chat lists or document viewers, keep the view aligned with the pane's content.

These changes apply only while content is scrolling. The mind2web Arm-0 config-hash pins were refreshed for the edited shader source.

## Download

macOS (Apple Silicon): [Scrutinizer-2.8.1-arm64.dmg](https://github.com/andyed/scrutinizer2025/releases/download/v2.8.1/Scrutinizer-2.8.1-arm64.dmg)
