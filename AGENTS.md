# Agent entry point

Read `CLAUDE.md` for the durable codebase map and repository rules before making
changes. For cross-machine work, also read
`docs/development/cross-machine-development.md`.

## Non-negotiable cross-machine rules

1. Git commits/branches are the only source-code handoff between macOS, Linux,
   native Windows, CI, and virtual machines.
2. Never copy or mirror `.git`, `node_modules`, `dist*`, `target`, coverage,
   caches, or an entire working tree between operating systems.
3. Every clone runs the pinned Bun locally and uses
   `bun install --frozen-lockfile`. Do not create npm/yarn/pnpm lockfiles.
4. `bun.lock`, `.bun-version`, `rust-toolchain.toml`, and the Desktop
   `Cargo.lock` are reproducibility contracts; update them intentionally.
5. Build Windows releases from a guest-local/local NTFS clone. In Apple Silicon
   Parallels use Windows x64 Bun under emulation and Rust target
   `x86_64-pc-windows-msvc`.
6. Use `prlctl exec "<VM>" --current-user ...` for Desktop, Edge, and UI
   validation. Default `SYSTEM` execution is not representative.
7. Shared folders may provide read-only IBT/MP4 inputs or receive final ZIP/SHA
   artifacts only.
8. Record branch, commit/dirty state, tool versions, input hashes, package
   checksum, and validation results in the active numbered plan.

Before handoff, run:

```bash
bun run repo:hygiene
bun run lint
bun run typecheck
bun run test:run
bun run build
```
