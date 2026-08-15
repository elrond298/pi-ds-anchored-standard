#!/usr/bin/env python3
"""External structural scorer; the tested agent does not run this."""
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
files = sorted(root.glob("*.html"))
if not files:
    print("TOTAL: 0/100 — no HTML file")
    raise SystemExit(1)
text = files[0].read_text(errors="replace")
checks = [
    (20, "HTML file", True),
    (20, "inline SVG", bool(re.search(r"<svg\b", text, re.I))),
    (20, "pelican semantics", bool(re.search(r"pelican|beak|pouch", text, re.I))),
    (20, "bicycle semantics", bool(re.search(r"bicycle|bike|wheel|pedal", text, re.I))),
    (20, "animation", bool(re.search(r"@keyframes|<animate\b|<animateTransform\b", text, re.I))),
]
total = sum(points for points, _, passed in checks if passed)
for points, label, passed in checks:
    print(f"{'PASS' if passed else 'FAIL'} ({points:2}) {label}")
print(f"artifact: {files[0].name} ({files[0].stat().st_size} bytes)")
print(f"TOTAL: {total}/100")
raise SystemExit(0 if total == 100 else 1)
