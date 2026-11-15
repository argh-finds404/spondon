# SPONDON (স্পন্দন) — Engineering Contract (`AGENTS.md`)

## PROJECT IDENTITY
- **Name**: SPONDON (স্পন্দন)
- **Type**: Browser-native real-time acoustic DSP laboratory
- **Purpose**: Educational / scientific visualization project
- **Scope Disclaimer**: Not a medical diagnostic product

## ARCHITECTURE PRINCIPLE
```text
Audio signal → preprocessing → windowing → FFT → pitch detection → LPC → formant extraction → Z-plane representation → vowel-space mapping → visualization
```

## AGENT OWNERSHIP
- **DSP agent owns**:
  - `src/lib/dsp/**`
  - `src/types/dsp.ts`
  - `src/workers/**`
  - `src/app/api/**` (the HTTP API: `/api/vowels`, `/api/synth`, `/api/analyze`; an exception to the frontend's `src/app/**`)
- **Frontend / visual agent owns**:
  - `src/app/**`
  - `src/components/**`
  - `src/styles/**`
- **Shared rules**:
  - Do not silently rewrite another agent's domain.
  - Do not replace working DSP algorithms with simplified fake implementations.
  - Do not generate fake telemetry.
  - Do not hardcode values that should come from the DSP engine.
  - Keep high-frequency telemetry outside React state when possible.
  - Avoid unnecessary allocations in audio/render loops.
  - Preserve TypeScript strictness.
  - Prefer small composable modules.
  - Do not introduce a backend unless explicitly requested.

## PERFORMANCE
- The application must target smooth real-time interaction.
- Never trigger React state updates for every audio frame merely to drive visualization.
- Use refs, animation loops (`requestAnimationFrame`), typed arrays (`Float32Array`, `Float64Array`, `Uint8Array`), and appropriate browser APIs (`AudioContext`, `AudioWorklet`, Web Workers).

## QUALITY
Before declaring a task complete, all of the following checks must pass:
```bash
npm run build
npx tsc --noEmit
npx vitest run
```
Do not claim success if any of these fail.

On Windows, run these from PowerShell (or `cd "D:/SPONDON"` in Git Bash): under Git Bash's lowercase `/d/SPONDON` path Vitest loads two copies of itself and every suite fails with "Cannot read properties of undefined (reading 'config')".

## SECURITY
Never commit:
- `.env`
- `.env.local`
- API keys
- tokens
- credentials
- private certificates

## DESIGN
- Avoid generic AI-generated SaaS dashboards.
- SPONDON should feel like a precision scientific instrument / acoustic laboratory.
- Do not add features outside the current task.
- Do not modify another agent's owned files without an explicit reason.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
