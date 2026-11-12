#!/usr/bin/env python3
"""Regenerate sitemap.xml from every index.html that isn't noindex.

lastmod = the date of the last git commit touching that page.
Prints the URLs whose entry changed (one per line) so the workflow can
send just those to IndexNow.
"""
import re
import subprocess
from pathlib import Path

SITE = "https://kopczynski.us"
ROOT = Path(__file__).resolve().parent.parent
NOINDEX = re.compile(r'<meta[^>]+name=["\']robots["\'][^>]*noindex', re.I)


def excluded():
    f = ROOT / "scripts" / "sitemap-exclude.txt"
    return {l.strip() for l in f.read_text().splitlines() if l.strip() and not l.startswith("#")}


def lastmod(path):
    out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", str(path)],
                         cwd=ROOT, capture_output=True, text=True).stdout.strip()
    return out or None


def pages():
    skip = excluded()
    for p in sorted(ROOT.rglob("index.html")):
        rel = p.relative_to(ROOT)
        if any(part.startswith(".") for part in rel.parts):
            continue
        url_path = "/" + "/".join(rel.parts[:-1]) + ("/" if len(rel.parts) > 1 else "")
        if url_path in skip or NOINDEX.search(p.read_text(errors="ignore")):
            continue
        yield url_path, lastmod(p)


def main():
    old = ROOT / "sitemap.xml"
    before = old.read_text() if old.exists() else ""
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    changed = []
    for path, mod in sorted(pages(), key=lambda x: (x[0] != "/", x[0])):
        loc = SITE + path
        entry = f"  <url><loc>{loc}</loc>" + (f"<lastmod>{mod}</lastmod>" if mod else "") + "</url>"
        lines.append(entry)
        if entry not in before:
            changed.append(loc)
    lines.append("</urlset>")
    old.write_text("\n".join(lines) + "\n")
    for u in changed:
        print(u)


if __name__ == "__main__":
    main()
