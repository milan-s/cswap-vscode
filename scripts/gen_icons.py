#!/usr/bin/env python3
"""Regenerate the CSwap icons from the original Claude logomark.

Source of truth: design/claude-ai-logo-source.svg (the Wikimedia "Claude_Ai"
logo — burst mark + "Claude" wordmark). We extract ONLY the burst path and
build every icon we ship from it, so the geometry never drifts.

Outputs:
  media/icon.svg            sidebar / activity-bar icon: burst + circular
                            swap arrows, arrows in currentColor (theme-adapting)
  media/plugin-icon.png     extensions-list / Marketplace tile (256x256):
                            cream background, terracotta burst, dark swap arrows
  icons-src/claude-logo.svg monochrome burst, the glyph source for the icon font

After running, rebuild the status-bar icon font (only needed if the burst
geometry changed):
  npx fantasticon icons-src -o media -n claude-icons -t woff -g json --normalize true

Requires: cairosvg  (pip install cairosvg)
"""
import math
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "design", "claude-ai-logo-source.svg")

# Brand colours
TERRACOTTA = "#D97757"   # the burst
CREAM = "#F0EEE6"        # plugin-icon background (authentic Claude surface)
CHARCOAL = "#262420"     # plugin-icon swap arrows

# The burst path lives inside a group translated by this offset in the source.
SRC_TRANSLATE = "translate(-75.96,-223.53)"
# Its first (absolute) moveto; everything after is relative, so flattening the
# group translate only requires shifting this one point.
SRC_MOVETO = "m 105.01,322.07"
FLAT_MOVETO = "m 29.05,98.54"   # = 105.01-75.96 , 322.07-223.53

CX = CY = 12.0   # centre of the 24x24 icon
R = 10.2         # radius of the swap-arrow ring


def burst_path():
    """Extract the burst (orange, .cls-2) path data from the source SVG."""
    svg = open(SOURCE).read()
    m = re.search(r'd="(m 105\.01.*?z)"', svg, re.S)
    if not m:
        raise SystemExit("Could not find the burst path in " + SOURCE)
    return m.group(1)


def polar(r, deg):
    a = math.radians(deg)
    return (CX + r * math.cos(a), CY + r * math.sin(a))


def arc(d0, d1, sweep, stroke, sw, hlen=3.4, hw=2.5):
    """A circular arrow on the ring: arc from d0 to d1 with a triangular head.
    The line ends flush (butt cap) and the head's tip extends just beyond it,
    so the stroke flows cleanly into the arrowhead with no overshoot."""
    x0, y0 = polar(R, d0)
    x1, y1 = polar(R, d1)                       # where the line ends
    tang = d1 + (90 if sweep else -90)          # tangent direction at the end
    hx, hy = math.cos(math.radians(tang)), math.sin(math.radians(tang))
    px, py = -hy, hx                            # perpendicular (head width)
    tip = (x1 + hx * hlen, y1 + hy * hlen)      # tip extends beyond the line
    b1 = (x1 + px * hw, y1 + py * hw)           # base corners flare at the end
    b2 = (x1 - px * hw, y1 - py * hw)
    return (
        f'<path d="M{x0:.2f},{y0:.2f} A{R},{R} 0 0 {sweep} {x1:.2f},{y1:.2f}" '
        f'fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="butt"/>'
        f'<path d="M{tip[0]:.2f},{tip[1]:.2f} L{b1[0]:.2f},{b1[1]:.2f} '
        f'L{b2[0]:.2f},{b2[1]:.2f} Z" fill="{stroke}"/>'
    )


def composite(burst, arrow_fill, sw=1.7, bg=None, burst_fill=TERRACOTTA, s=0.092):
    """24x24 icon: smaller centred burst + a top and bottom circular swap arrow."""
    bw = 148.18 * s
    off = (24 - bw) / 2
    g = f"translate({off:.2f},{off:.2f}) scale({s:.4f}) {SRC_TRANSLATE}"
    rect = f'  <rect width="24" height="24" rx="5" fill="{bg}"/>\n' if bg else ""
    return (
        '<svg width="24" height="24" viewBox="0 0 24 24" '
        'xmlns="http://www.w3.org/2000/svg">\n'
        f'{rect}'
        f'  <path transform="{g}" fill="{burst_fill}" d="{burst}"/>\n'
        f'  {arc(-160, -20, 1, arrow_fill, sw)}\n'
        f'  {arc(20, 160, 1, arrow_fill, sw)}\n'
        '</svg>\n'
    )


def main():
    burst = burst_path()

    # 1) Sidebar / activity-bar icon (theme-adapting arrows).
    with open(os.path.join(ROOT, "media", "icon.svg"), "w") as f:
        f.write(composite(burst, arrow_fill="currentColor"))

    # 2) Extensions-list tile: colored, self-contained -> PNG.
    import cairosvg
    plugin_svg = composite(burst, arrow_fill=CHARCOAL, bg=CREAM)
    cairosvg.svg2png(bytestring=plugin_svg.encode(),
                     write_to=os.path.join(ROOT, "media", "plugin-icon.png"),
                     output_width=256, output_height=256)

    # 3) Icon-font glyph source: monochrome burst with the group translate
    #    flattened into the first moveto (fantasticon ignores group transforms).
    flat = burst.replace(SRC_MOVETO, FLAT_MOVETO, 1)
    with open(os.path.join(ROOT, "icons-src", "claude-logo.svg"), "w") as f:
        f.write(
            '<svg width="148.18" height="148.18" viewBox="0 0 148.18 148.18" '
            'xmlns="http://www.w3.org/2000/svg" fill="currentColor">'
            f'<path d="{flat}"/></svg>\n'
        )

    print("Regenerated media/icon.svg, media/plugin-icon.png, "
          "icons-src/claude-logo.svg")
    print("If the burst changed, rebuild the font:\n"
          "  npx fantasticon icons-src -o media -n claude-icons "
          "-t woff -g json --normalize true")


if __name__ == "__main__":
    main()
