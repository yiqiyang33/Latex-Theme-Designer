import sys, re, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from oklch import oklch_to_hex, contrast

# Family hues, evenly spaced, each near its conventional identity.
HUE = {"claim":25,"corollary":60,"assumption":98,"proposition":140,"definition":180,
       "axiom":215,"theorem":250,"fact":288,"lemma":325}
# Callouts sit between family hues (+18 deg) so they never land on a family colour.
CALLOUT_HUE = {"insight":198,"pitfall":8,"intuition":307,"summary":268,"question":78,
               "example":162,"remark":232,"assump":116}

def warp(h, center, spread):
    d = ((h - center + 180) % 360) - 180
    return (center + d*spread) % 360

SPEC = {
 # The three light presets are separated by WEIGHT, not by hue: compressing hues far
 # enough to tell them apart is what pushed blue into violet, so instead meadow is pale
 # and muted, default is balanced, and ember is deep and saturated.
 "meadow":   dict(center=152, spread=0.88, title=(0.956,0.020), body=(0.987,0.008),
                  accent=(0.600,0.068), fg=(0.380,0.050), callout=(0.960,0.022),
                  spine=(0.600,0.068)),
 "default":  dict(center=215, spread=1.00, title=(0.925,0.029), body=(0.975,0.011),
                  accent=(0.575,0.082), fg=(0.365,0.058), callout=(0.940,0.030),
                  spine=(0.575,0.082)),
 "ember":    dict(center=42,  spread=0.88, title=(0.888,0.050), body=(0.962,0.020),
                  accent=(0.520,0.110), fg=(0.320,0.078), callout=(0.905,0.046),
                  spine=(0.520,0.110)),
 # Dark tier: ink bar, paper text, family colour on the spine. Callouts get a deep tint
 # and an ink spine so they belong to the same page instead of floating on it.
 "midnight": dict(center=0, spread=0.0, title=(0.305,0.014), body=(0.966,0.008),
                  accent=(0.520,0.105), fg=(0.965,0.006), callout=(0.905,0.030),
                  spine=(0.360,0.055), dark=True),
}

def build(preset):
    s = SPEC[preset]; out = {}
    dark = s.get("dark", False)
    def H(h): return h if dark else warp(h, s["center"], s["spread"])
    def title_pair(h):
        # In the dark tier the bar is ink and the text is paper; elsewhere the reverse.
        return (oklch_to_hex(*s["title"], H(h) if not dark else 250),
                oklch_to_hex(*s["fg"], H(h) if not dark else 250))
    for fam, h in HUE.items():
        tb, tf = title_pair(h)
        out[f"{fam}-body-bg"]  = oklch_to_hex(*s["body"], H(h))
        out[f"{fam}-title-bg"] = tb
        out[f"{fam}-title-fg"] = tf
        out[f"{fam}-accent"]   = oklch_to_hex(*s["accent"], H(h))
    for prefix, h in (("note",250), ("chapter-overview",250)):
        tb, tf = title_pair(h)
        out[f"{prefix}-bg"]       = oklch_to_hex(*s["body"], H(h))
        out[f"{prefix}-title-bg"] = tb
        out[f"{prefix}-title-fg"] = tf
        out[f"{prefix}-accent"]   = oklch_to_hex(*s["accent"], H(h))
    out["note-frame"] = oklch_to_hex(min(s["title"][0]+0.0, 0.90) if dark else s["title"][0]-0.035,
                                     s["title"][1], H(250))
    # Callouts are single-tone on light paper in every tier, including the dark one.
    label_L, label_C = (0.300, 0.070) if dark else (s["fg"][0] - 0.02, s["fg"][1])
    for name, h in CALLOUT_HUE.items():
        out[f"{name}-bg"]       = oklch_to_hex(*s["callout"], H(h))
        out[f"{name}-label-fg"] = oklch_to_hex(label_L, label_C, H(h))
        out[f"{name}-accent"]   = oklch_to_hex(*s["spine"], H(h))
    out["remark-inline-fg"] = oklch_to_hex(label_L+0.12, label_C, H(232))
    return out

src = pathlib.Path("src/stylePresets.ts").read_text()
n = 0
for preset in SPEC:
    new = build(preset)
    start = src.index(f'id: "{preset}"'); end = src.index("\n  }", start)
    block = src[start:end]
    for token, value in new.items():
        pat = re.compile(r'("%s":\s*)"#[0-9A-Fa-f]{6}"' % re.escape(token))
        block, c = pat.subn(lambda m: m.group(1) + f'"{value}"', block)
        if c != 1: raise SystemExit(f"{preset}/{token}: {c}")
        n += 1
    src = src[:start] + block + src[end:]
pathlib.Path("src/stylePresets.ts").write_text(src)

# report
for preset in SPEC:
    d = build(preset)
    worst = min(contrast(d[f"{f}-title-fg"], d[f"{f}-title-bg"]) for f in HUE)
    print(f"{preset:<9} title bar L={SPEC[preset]['title'][0]:.3f}  worst title contrast {worst:.1f}:1")
print("rewrote", n, "values")
