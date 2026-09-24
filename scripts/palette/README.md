# Block palette generator

Regenerates the theorem-block, callout and note colors in
`src/stylePresets.ts` so every family sits at the same lightness and chroma
for its role, on an evenly spaced hue ring.

    python3 scripts/palette/generate.py      # run from the repo root
    node scripts/palette/sync-theme-sty.mjs  # push the default preset into theme.sty

Tune a preset by editing `SPEC` in `generate.py`:

- `center` / `spread` give the preset its hue world. `spread` 1.0 keeps the full
  ring; lower values pull every family toward `center`, which is what makes
  ember warm and meadow green. Below about 0.8 distant hues start wrapping into
  the wrong region (blue turning violet), so keep it high unless you check the
  result.
- `title` / `body` / `accent` / `fg` / `callout` are `(lightness, chroma)` in
  OKLCH. Lightness sets the tier: meadow 0.945, default 0.926, ember 0.930,
  midnight 0.305.
- `dark=True` flips the title bar to ink with paper-colored text and moves the
  family color onto the accent spine. midnight uses it.

`uchicago` is deliberately absent: its maroon is brand identity, not a
generated value, and a generic hue ring flattens it to grey.

Regenerating rewrites 280 values; run `npm test` afterwards. The suite pins
every preset to exactly `COLOR_ORDER` and checks `theme.sty` agrees with the
default preset.
