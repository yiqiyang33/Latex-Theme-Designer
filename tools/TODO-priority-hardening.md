# Priority TODO: Structure + Robustness (Active)

Completed backlog items were removed. This file now tracks only remaining work.

## P0 (Critical)

### P0-3 Existing workspace corruption detection + repair path

- [ ] Add one-shot repair helper (CLI) for common corruption shape.
  - Recover section file content from backup when available (`*.bak*`) or stop with explicit manual-fix guidance.

Acceptance:
- Corrupted legacy/subfile-misuse projects fail fast with clear diagnostics.
- User can recover with one documented command/path without manual log digging.
