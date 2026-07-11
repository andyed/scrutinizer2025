# Phase 2 — Automation ergonomics

*Goal of the phase: turn Scrutinizer from a one-shot capture pipeline + fragile AppleScript into a **drivable instrument**, and fix the agent-posture wiring so any model (or a clone) can build/test/run/register-tools without spelunking. The control plane (P2-1) is the keystone — it's what makes Phase 3's controlled studies possible.*

**Gate:** do this once Phase 0/1 make the data trustworthy. A drivable instrument producing untrustworthy data is worse than a slow one.

---

## P2-1 — Persistent control plane (the keystone) ⭐

**Goal:** Today there are only two automation modes and nothing between them: (a) one-shot spawn-and-exit via `TEST_*` env vars (`main.js:2925-2930` dispatches then the app exits), and (b) AppleScript menu-clicking on a running GUI. There is **no way to drive a running instance** — no session start/stop, no set-fixation, no set-mode, no state query, no event-log export. Build a localhost control surface. This single investment replaces the AppleScript skill, makes `JSPSYCH_INTEGRATION_SPEC.md` implementable, and is the prerequisite for every Phase 3 study.

**Files:** new `renderer/control-server.js` (or reuse Electron's CDP remote-debugging port); `main.js` (wire IPC handlers + start the server under a flag); reference `docs/JSPSYCH_INTEGRATION_SPEC.md` (already sketches this direction, status Proposal).

**Design (keep it minimal and JSON-in/JSON-out):**
A localhost HTTP or WebSocket server, enabled by `CONTROL_PORT=<n>` env var (off by default), exposing:

| Command | Args | Returns |
|---------|------|---------|
| `session/start` | `{participantId, taskId, condition}` | `{sessionId}` |
| `session/stop` | `{sessionId}` | `{path}` (written event log) |
| `set-mode` | `{mode: <id>}` | `{ok, mode}` |
| `set-enabled` | `{enabled: bool}` | `{ok}` |
| `set-fixation` | `{x, y}` (canvas px) | `{ok}` |
| `set-radius` | `{radius}` | `{ok}` |
| `get-state` | — | `{mode, enabled, fixation, radius, computeTier, corticalPoolingAvailable}` |
| `export-event-log` | `{sessionId}` | JSONL (fixations, mode changes, scroll, clicks, timestamps) |

**Steps:**
1. The IPC scaffolding for settings already exists (`main.js:92-134`: `settings:enabled-changed`, `settings:radius-changed`, `settings:visual-memory-changed`, `settings:page-changed`). Add the two missing programmatic handlers: **set-mode** (no IPC path exists to switch foveation mode programmatically — this is the P2-2 dependency too) and **set-fixation** (drive `GazeModel.getPosition` externally, same interface scanpath-player already uses at `scrutinizer.js:352-354`).
2. Build the control server as a thin translator: HTTP/WS request → existing IPC message → response. Reuse `get-state` from the tier-stamping work in P1-5.
3. `get-state` must include `computeTier` + `corticalPoolingAvailable` so a study can refuse to run on a degraded GPU.
4. Guard it: bind to `127.0.0.1` only, enabled solely when `CONTROL_PORT` is set. This is a local research tool, not a network service.
5. Emit a structured event log: on session/start, begin appending JSONL events (fixation moves, mode/enabled changes, scrolls, clicks) with `performance.now()` timestamps; session/stop flushes to a file and returns the path.

**Verify:**
```
CONTROL_PORT=7777 npm start &   # launch app with control plane
sleep 8
curl -s localhost:7777/get-state | head
curl -s -XPOST localhost:7777/set-mode -d '{"mode":14}' && curl -s localhost:7777/get-state
# expect state to reflect mode 14
```
**Done when:** a running instance can be driven end-to-end over localhost (start session → set mode → set fixation → get state → stop → read event log), with the app still exiting cleanly and the port off by default.

- [ ] P2-1 complete

---

## P2-2 — Programmatic per-trial condition toggle

**Goal:** Scrutinizer on/off/mode is menu-driven only; there's no scriptable way to A/B foveated-vs-normal per trial. Small but **blocking** for controlled studies. This is the `set-mode` / `set-enabled` half of P2-1 — call it done when a runner can flip condition without a human.

**Files:** `main.js` IPC handlers (extends the P2-1 set); `renderer/scrutinizer.js` (apply mode/enabled at runtime without a settings write — see P2-5 to avoid mutating persisted state).

**Steps:** covered by P2-1's `set-mode` and `set-enabled`. This ticket exists so the Phase 3 dependency is explicit: **P3 ExperimentRunner cannot sequence conditions without this.**

**Verify:** the P2-1 curl for `set-mode` + a `set-enabled` toggle round-trips in `get-state`.

**Done when:** foveation mode and enabled-state are settable per trial over the control plane, and toggling does not require restarting the app.

- [ ] P2-2 complete (folds into P2-1)

---

## P2-3 — TEST_MODE must not mutate persisted user settings

**Goal:** `main.js` `runIntegrationTest` calls `settingsManager.set('mobileEmulation', ...)` unconditionally on every headless run (~`main.js:1545-1553`). Headless automation writes to the same settings store the interactive GUI reads — a batch run mid-session flips the GUI's state and vice versa. The control plane (P2-1) makes this worse (more programmatic writes), so fix it here.

**Files:** `main.js` (settings writes under TEST_MODE); `settings-manager.js`.

**Steps:**
1. When `TEST_MODE=true` (or `CONTROL_PORT` is set), load settings into an **in-memory overlay** instead of writing the persistent store — or point `settings-manager` at a temp file.
2. Ensure the control-plane `set-*` commands from P2-1 also write only to the overlay, never the user's real settings.

**Verify:**
```
# capture the settings file mtime, run a headless capture, confirm it did NOT change
f=~/Library/Application\ Support/*scrutinizer*/settings.json  # adjust to real path
stat -f %m $f 2>/dev/null; TEST_MODE=true npm run capture-smoke >/dev/null 2>&1; stat -f %m $f 2>/dev/null
# two mtimes should be identical
```
**Done when:** a TEST_MODE/control-plane run leaves the persisted settings file byte-unchanged.

- [ ] P2-3 complete

---

## P2-4 — Deterministic DPR pin on the capture path

**Goal:** Capture reproducibility is display-dependent. `main.js:1438-1440` pins DPR only via `force-device-scale-factor` (TODO.md:19 records it "floats with the host display, DPR-1↔DPR-2"). `Emulation.setDeviceMetricsOverride` exists only on the mobile-emulation path (`main.js:252`, `applyMobileEmulation`), not the TEST_MODE capture path. Without this, bio-validation curves aren't reproducible across machines — it gates the trustworthiness of the psychophysics calibration and Brown-metamer re-run.

**Files:** `main.js` (TEST_MODE capture setup; reuse the debugger-attach pattern from `applyMobileEmulation` at ~:252).

**Steps:**
1. On the TEST_MODE / capture BrowserView targets, attach the debugger and call `Emulation.setDeviceMetricsOverride({ deviceScaleFactor: TEST_DPR || 2, width, height, mobile: false })` — mirroring how `applyMobileEmulation` already does it.
2. Record the effective DPR in the capture manifest (alongside the compute tier from P1-5).

**Verify:**
```
# run the same capture on-demand; the manifest DPR should be exactly 2 regardless of host display
grep -rl "deviceScaleFactor\|\"dpr\"" tests/golden-captures/ 2>/dev/null | head
```
**Done when:** captures pin DPR=2 deterministically via CDP (not host-dependent), and the manifest records it. Unblocks TODO.md items #1 (psychophysics calibration) and #3 (Brown re-run).

- [ ] P2-4 complete

---

## P2-5 — Register the MCP server so agents can use it on clone

**Goal:** `cli/mcp/server.js` defines a working 4-tool `scrutinizer-audit` stdio server (deps installed, 3 analysis tools verified working), but no `.mcp.json` exists, so no agent can call it without a manual `claude mcp add`.

**Files:** create `scrutinizer2025/.mcp.json`.

**Steps:**
1. Create `.mcp.json` at `scrutinizer2025/` registering the server:
   ```json
   { "mcpServers": { "scrutinizer-audit": { "command": "node", "args": ["cli/mcp/server.js"] } } }
   ```
2. Note in `cli/README.md` that the server is now auto-registered on clone (removing the manual `claude mcp add` as the only path).
3. Document the 4th tool (`capture_vision`) — README and `server.js:8` header both say "3 tools"; the TOOLS array has 4 (`server.js:96-125`). Fix the count and add `capture_vision` to the tool table (note its dependency on root `npm install` + 25s timeout).

**Verify:**
```
test -f .mcp.json && node -e "const j=require('./.mcp.json'); console.log('registers:', Object.keys(j.mcpServers))"
grep -c "capture_vision" cli/README.md
```
**Done when:** `.mcp.json` registers `scrutinizer-audit`, and `capture_vision` is documented with the corrected "4 tools" count.

- [ ] P2-5 complete

---

## P2-6 — Track the vision-scientist agent; stop leaking settings.local.json

**Goal:** `.claude/agents/vision-scientist.md` is untracked while its memory (`.claude/agent-memory/vision-scientist/*.md`) IS committed — a clone gets the review notes but not the agent that reads them. Separately, `.claude/settings.local.json` is committed, leaking a personal allowlist + machine paths + `enabledMcpjsonServers`.

**Files:** `.claude/agents/vision-scientist.md`, `.claude/settings.local.json`, `.gitignore`.

**Steps:**
1. `git add .claude/agents/vision-scientist.md` so the agent ships with its memory.
2. Add `.claude/settings.local.json` to `.gitignore` and `git rm --cached .claude/settings.local.json`. Keep shared rules in `.claude/settings.json`; move any genuinely-shared permission from local → shared.
3. Decide `scrutinizer-www/.claude/` (currently entirely untracked `?? .claude/`): either commit `settings.json` (shared hook config, matches scrutinizer2025) or gitignore `.claude/`. Don't leave it dangling.

**Verify:**
```
git ls-files .claude/agents/ | grep vision-scientist && echo "agent tracked"
git check-ignore .claude/settings.local.json && echo "local settings now ignored"
```
**Done when:** the agent is tracked, `settings.local.json` is ignored+uncached, and www's `.claude` is deliberately committed-or-ignored.

- [ ] P2-6 complete

---

## P2-7 — Fix CLAUDE.md stale facts + add missing orientation

**Goal:** The flagship CLAUDE.md carries drifting facts and omits routine commands; sibling repos and the family root have no agent orientation at all. Low-complexity executors currently can't build/test/run without file spelunking.

**Files:** `scrutinizer2025/CLAUDE.md`; new `scrutinizer-repo/CLAUDE.md` (family root); new `scrutinizer-figma/CLAUDE.md`; new `PooledStatisticsMetamers/CLAUDE.md`.

**Steps:**
1. **Flagship CLAUDE.md fixes:**
   - Drop the exact shader line count ("2388 lines" → actual 2563 and drifting) — say "~2.5k lines" or remove.
   - Fix the related-repos list: it lists `fovi/` and `clicksense/` as if in-family, but they live at `~/Documents/dev/`, not under `scrutinizer-repo/`. Meanwhile `scrutinizer-figma/` (a real in-family sibling) is never mentioned. Say "3 sub-repos" → 4 git repos + research/drafts/shared/signing.
   - Add a 4-line **Common commands** block: `npm start` (run), `npm test` (full) / `npx jest --selectProjects unit` (fast), `npm run capture-golden`, `/release`.
2. **Family-root CLAUDE.md** (`scrutinizer-repo/CLAUDE.md`): thin router — which sub-repo is which, flagship = scrutinizer2025, point to each sub-repo's CLAUDE.md.
3. **scrutinizer-figma/CLAUDE.md:** short — build/test/run for the Figma plugin port, note it mirrors the desktop shader.
4. **PooledStatisticsMetamers/CLAUDE.md:** one paragraph marking it **vendored Brown/Rosenholtz code — don't refactor; upstream is the Brown lab** (mirrors the CLAUDE.md "don't rebuild in other repos" pattern).

**Verify:**
```
grep -c "2388" scrutinizer2025/CLAUDE.md   # expect 0
for f in ../CLAUDE.md ../scrutinizer-figma/CLAUDE.md ../PooledStatisticsMetamers/CLAUDE.md; do test -f "$f" && echo "exists: $f"; done
```
**Done when:** no stale line count, related-repos list is correct + includes figma, common commands present, and all three new CLAUDE.md files exist.

- [ ] P2-7 complete

---

## P2-8 — Regenerate the codebase map + knowledge graph; sync the /scrutinizer skill labels

**Goal:** `CODEBASE_MAP.md` and `knowledge-graph.json` are ~26 commits / 2 weeks stale (miss June static-stimulus + L1 ADR work). The `/scrutinizer` AppleScript skill's menu labels have drifted from `menu-template.js` — mode switching via that skill fails on exact-label mismatch.

**Files:** `docs/CODEBASE_MAP.md`, `.understand-anything/knowledge-graph.json`, `~/.claude/skills/scrutinizer/SKILL.md`.

**Steps:**
1. Regenerate the map (`/cartographer`) and knowledge graph (`/understand`) after the June work — OR, cheaper, add a `last-verified: <date>` staleness banner to both so agents know to distrust specifics.
2. Sync the `/scrutinizer` skill's label table to `menu-template.js` actuals (e.g. "High-Key Ghosting" line 807, "FOVI Cortical Grid (Blauch) (Default)" line 864, Utility→Test Modes submenu — NOT the "Research" submenu the skill assumes). Also: the skill targets process "Electron" generically, colliding with other Electron dev apps — narrow it or have it call `/scrutinizer menu` to fuzzy-match first.
3. **Better long-term:** once P2-1 lands, retarget the `/scrutinizer` skill from AppleScript menu-clicking to the control-plane HTTP API — deterministic, no label drift.

**Verify:**
```
grep -m1 "last_mapped\|last-verified" docs/CODEBASE_MAP.md
# skill label check: compare against menu-template.js
grep -n "High-Key Ghosting\|FOVI Cortical Grid" menu-template.js | head
```
**Done when:** map/graph are regenerated or banner-stamped, and the skill's labels match `menu-template.js` (or it's retargeted to the control plane).

- [ ] P2-8 complete

---

## Phase 2 exit criteria

A running instance is drivable over localhost (start/stop/set-mode/set-fixation/get-state/export-log); TEST_MODE no longer mutates user settings; captures pin DPR deterministically; the MCP server is auto-registered; the vision-scientist agent + correct CLAUDE.md orientation ship on clone; the `/scrutinizer` skill works against real labels or the control plane. **The instrument is now automatable without a human in the loop.**
