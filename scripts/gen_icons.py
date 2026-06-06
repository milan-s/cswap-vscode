#!/usr/bin/env python3
"""Generate the Claude 'sunburst' logomark as filled capsule rays.

Output is monochrome SVG using fill="currentColor" so it adapts to the
VSCode theme (activity-bar mask + status-bar icon font both want this).
We emit FILLED paths (no strokes) so the same geometry converts cleanly
into an icon font glyph.
"""
import math

CX, CY = 12.0, 12.0


def capsule(ax, ay, bx, by, r):
    """Path for a stadium/capsule shape from A to B with radius r."""
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length          # unit direction
    nx, ny = -uy, ux                            # unit normal
    a1 = (ax + nx * r, ay + ny * r)
    a2 = (ax - nx * r, ay - ny * r)
    b1 = (bx + nx * r, by + ny * r)
    b2 = (bx - nx * r, by - ny * r)
    return (
        f"M{a1[0]:.3f},{a1[1]:.3f} "
        f"L{b1[0]:.3f},{b1[1]:.3f} "
        f"A{r:.3f},{r:.3f} 0 0 0 {b2[0]:.3f},{b2[1]:.3f} "
        f"L{a2[0]:.3f},{a2[1]:.3f} "
        f"A{r:.3f},{r:.3f} 0 0 0 {a1[0]:.3f},{a1[1]:.3f} Z"
    )


def burst(n=12, ri=2.6, ro_long=10.4, ro_short=8.2, width=1.85,
          cx=CX, cy=CY, start_deg=-90.0):
    """Radial burst of n capsule rays, alternating long/short for an
    organic, hand-drawn feel like the Claude mark."""
    r = width / 2.0
    paths = []
    for i in range(n):
        ang = math.radians(start_deg + i * 360.0 / n)
        ro = ro_long if i % 2 == 0 else ro_short
        ax, ay = cx + math.cos(ang) * ri, cy + math.sin(ang) * ri
        bx, by = cx + math.cos(ang) * ro, cy + math.sin(ang) * ro
        paths.append(capsule(ax, ay, bx, by, r))
    return paths


def svg(paths, size=24):
    body = "\n  ".join(f'<path d="{p}"/>' for p in paths)
    return (
        f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" '
        f'xmlns="http://www.w3.org/2000/svg" fill="currentColor">\n  '
        f'{body}\n</svg>\n'
    )


# --- glyph (status-bar font + base mark): full-size centered burst ---
glyph = burst()
with open("media/claude-burst.svg", "w") as f:
    f.write(svg(glyph))

# --- sidebar: smaller burst up-left + swap-arrows badge bottom-right ---
side = burst(n=12, ri=1.9, ro_long=7.6, ro_short=6.0, width=1.5,
             cx=9.0, cy=8.6)
# Two swap arrows (right-pointing on top, left-pointing below) as a badge.
badge = [
    # top arrow shaft + head, pointing right
    "M13.0,17.4 L19.0,17.4 L19.0,16.0 L22.0,18.1 L19.0,20.2 L19.0,18.8 "
    "L13.0,18.8 Z",
    # bottom arrow shaft + head, pointing left
    "M22.0,21.0 L16.0,21.0 L16.0,19.6 L13.0,21.7 L16.0,23.8 L16.0,22.4 "
    "L22.0,22.4 Z",
]
with open("media/icon.svg", "w") as f:
    f.write(svg(side + badge))

print("wrote media/claude-burst.svg and media/icon.svg")
