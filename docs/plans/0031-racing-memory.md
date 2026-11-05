# Plan 0031 — Racing Memory MVP

## Goal

Turn iRacing telemetry plus a separately recorded, synchronized video into
locally exportable race-memory clips. The feature stays offline-first: telemetry
analysis, video mapping, encoding, and download all run in the browser.

## Approach

- Expose iRacing race-state channels as ordinary parser extra fields so the core
  parser remains game-neutral.
- Detect best lap, position gains, incident-count changes, and session end in a
  pure plugin-owned function.
- Add a self-gating `Memory` plugin panel slot and lazy-load its UI.
- Reuse the existing session/video synchronization model and browser video
  exporter rather than introducing a second media pipeline.
- Keep real `.ibt` fixtures outside the repository and enable their integration
  test through `RACING_IBT_GOLDEN`.

Detailed architecture, algorithms, limitations, and verification evidence live
in [`docs/racing-memory.md`](../racing-memory.md).

## Touch points

- `src/lib/iracingParser.ts`
- `src/plugins/racing-memory/`
- `src/plugins/panels.ts`
- `src/components/tabs/MemoryTab.tsx`
- `src/pages/Index.tsx`
- `docs/racing-memory.md`
- `docs/open-source-landscape.md`

## Status

The MVP is implemented. Follow-up work includes merged multi-event reels,
stronger event classification, configurable windows, overlays, localization,
and export cancellation/cleanup.
