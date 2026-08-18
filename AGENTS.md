# AKULA local runtime rules

- Use only `http://127.0.0.1:4173/` for local development and preview.
- Before starting Vite, check whether AKULA already listens on port `4173`. Reuse
  that server; never launch AKULA on `5173`, an automatically incremented port,
  or a second local origin.
- Reuse an existing AKULA browser tab when one is available. Open duplicate tabs
  only for an explicit multi-instance regression test, and close them when the
  test ends.
- Do not bypass `AudioSessionCoordinator` or the canonical-local-origin gate.
  Only the foreground AKULA instance may have nonzero master output.
