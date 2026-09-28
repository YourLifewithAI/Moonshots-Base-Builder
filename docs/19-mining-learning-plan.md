# Mining progression and learning implementation

Scope: review recommendations 1–3 and 8, following the extraction-hub model in
`17-extraction-hubs.md` and the current status in `18-follow-ups.md`.
The player should understand a working mine, improve it through reachable
research, delegate routine dispatch, and connect its technology to real work.

## 1. Reachable mining progression

- Keep the saved `regolithProcessing` ID for Pit Mapping. Add Bay Extensions,
  Hardfaced Teeth, Water Reclamation, Water Electrolysis, Deep Coring and Depot
  Halls at their intended eras. Update descriptions and actual modifiers together.
- Research permits bay purchases; it does not silently grant purchased capacity.
  Apply print speed/cost, digging, upkeep and deeper-bench effects to hub units.
- Water recovery reduces consumption only while a water plant operates.
  Electrolysis is an explicit per-plant choice with its own power and water cost.
- Preserve completed research, queues and existing hub/unit saves.

Acceptance: ordinary research opens the upgrade; queue/refusal text names the
missing research; purchased bays and newly opened benches work; water and power
changes match their descriptions; legacy research remains completed.

## 2. Hub-aware delegation

- Replace the visible old extractor rules with one hub-unit growth rule and
  migrate enabled state, counts and caps without enabling a previously off rule.
- Feed Planner evaluates deliverable product, grade, round-trip time, free faces,
  remaining ore, grid headroom and reserves. Offer balanced production, power
  conservation and night-feed policies, with a plain-language explanation.
- Respect manual targets, recall, disabled units, opt-outs, storm holds and the
  Builder freeze. Avoid reassignment while carrying a load and use hysteresis.
- Printing requires a useful destination, free bay, sustainable ore, adequate
  power and affordable resources after the player's reserves.

Acceptance: new hub units participate; policy changes affect choices; a pinned or
recalled unit stays put; a constrained grid or occupied face prevents growth;
old rules migrate predictably; explanations agree with the decision.

## 3. Guided first mine

- Add an optional, replayable short guide using the actual selected site and
  current simulation state. Teach the deposit, hub, unit, face, hopper and grade.
- Link each step to useful camera, overlay, placement or inspection controls.
  Detect a real working mine and explain its current blocker.
- Correct the resource help and milestones that still describe old freestanding
  extractors or a global hopper. Mature saves start with a quiet guide.

Acceptance: fresh human/robotic starts and each landing site receive achievable
guidance; hide/replay works; narrow screens retain usable controls; the guide
does not claim success merely because a building was placed.

## 8. Evidence and engineering demonstrations

- Add curated primary-source company links across the industrial chain, including
  new mining research. Each card distinguishes commercial Earth technology,
  ground demonstrations, flight demonstrations and concepts.
- Explain what exists, what remains difficult on the Moon, and what the game
  abstracts. Record when sources were checked and avoid invented lunar readiness.
- Add optional engineering pilots using the existing Insight discount system:
  observable mine and factory achievements reward learning without mandatory
  research locks or a second currency. Fix extractor-based deeds for hub units.
- Expose source links in an accessible, scrollable research detail panel using
  the established monochrome typography, spacing and restrained accent colors.

Acceptance: links resolve to relevant official sources; evidence cannot queue
research by accident; pilot completion follows simulation progress and survives
saves; unsourced nodes do not imply verification; mobile details remain readable.

## Verification and delivery

1. Typecheck/build; deterministic focused tests for research, water, migration,
   planner constraints, guide progression, evidence and earned discounts.
2. Existing hub/pit/reserve/research tests where relevant; distinguish obsolete
   extractor fixtures from regressions and repair only fixtures needed here.
3. Desktop and narrow-screen visual checks of the guide, hub and research UI.
4. Regenerate research documentation; document shipped behavior and limitations.

Weather shields, new hazards, general rendering work and unrelated save-system
changes remain separate follow-ups. This change does not represent a simulation
of a complete or commercially proven lunar industrial supply chain.

## Implemented and verified — September 27, 2026

All four scoped improvements are implemented. The evidence catalogue covers 31
technologies with 26 distinct primary links; six engineering pilots use saved
Insight discounts. Fleet OS now provisions a real extra bay on clear ground;
blocked bay jobs wait and remain refundable. The new fields survive save/reload,
and old extraction rules and active runaway-rule indices migrate once.

Validation completed:

- Production TypeScript/Vite build and generated documentation check passed.
- 68 tests passed together: `evidence`, `firstMine`, `hubPlanner`, `hubs`,
  `hubview`, `miningIntegration`, `miningResearch`, `pits` and `reserves`.
- Two technology-data/geometry-budget checks and two research-page layout checks
  passed, for 72 distinct checks in this scope.
- Visual review covered desktop and touch guidance and the engineering notebook
  at 1280×720 and 390×844. Keyboard source activation, Escape and restored focus
  are covered by the integration test.

The local run used installed Chromium 1234 through a temporary Playwright config.
The final combined run used a fresh Vite process: editing source while browser
tests dynamically import modules can split module-local terrain state under HMR.
Temporary configs are not part of the change. Vite still reports the existing
large-bundle warning; the build succeeds. The full older standalone-extractor
suite and long-run pacing diagnostic remain tracked in docs/18.
