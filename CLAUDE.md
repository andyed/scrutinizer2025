# Scrutinizer — Claude Code Context

Flagship foveated vision research instrument. Electron + WebGL 2.0 + WebGPU compute. 886+ GLSL lines modeling LGN/V1/V4/DoG neuroscience. 3 sub-repos in `scrutinizer-repo/`.

## Testing

- **Jest** (not Vitest — Electron/Node compatibility). Don't introduce Vitest here.
- `uv run --python 3.12` for validation scripts.
- Tests cover core vision algorithms and parameter systems, not UI.

## Libraries

- Electron, raw WebGL 2.0, WebGPU compute shaders
- Python validation scripts via uv

## Key Rules

- This is a primary research instrument with an arXiv paper, not a demo.
- Related repos: `scrutinizer-www/` (marketing), `PooledStatisticsMetamers/` (Brown/Rosenholtz), `fovi/` (PyTorch), `clicksense/` (motor behavior).
- See `cli/README.md` for automation scripts, MCP server, headless capture pipeline.
- `/scrutinizer <command>` skill controls the running app via AppleScript.
