# LaTeX Editing Toolkit TODO (Active)

Completed backlog items were removed. This file now tracks only active work.

## Current Status

- No open feature TODOs in this track.

## Next Candidate

- [ ] Implement the corruption auto-repair CLI tracked in `tools/TODO-priority-hardening.md` (P0-3).
- [ ] Implement dual-mode clean policy: conservative root + aggressive subfile cleanup.
- [ ] Add automatic subfile-directory discovery from `\documentclass[..]{subfiles}` units.
- [ ] Keep only `.tex/.pdf` in discovered subfile directories during clean.
- [ ] Prune empty directories under subfile scopes after file cleanup.
- [ ] Extend `/api/clean` payload with root/subfile policy breakdown fields.
- [ ] Update UI clean log rendering for dual-policy visibility.
- [ ] Add/adjust tests for auto-discovery, aggressive deletion, and empty-dir pruning.
- [ ] Update README docs to reflect new clean semantics.
