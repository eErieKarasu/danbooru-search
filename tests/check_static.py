"""Check the static app's DOM wiring, local assets and JavaScript syntax."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


class Document(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.references = []
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        for name in ("for", "aria-labelledby", "aria-describedby"):
            self.references.extend(attrs.get(name, "").split())
        if tag in {"img", "script", "link"}:
            asset = attrs.get("src") or attrs.get("href")
            if asset:
                self.assets.append(asset)
        if tag == "use" and attrs.get("href", "").startswith("#"):
            self.references.append(attrs["href"][1:])


def main():
    document = Document()
    document.feed((ROOT / "index.html").read_text())
    duplicates = [value for value, count in Counter(document.ids).items() if count > 1]
    assert not duplicates, f"Duplicate IDs: {duplicates}"
    source = (ROOT / "js/app.js").read_text()
    selectors = re.findall(r'querySelector\(["\']#([\w-]+)["\']\)', source)
    missing = set(document.references + selectors) - set(document.ids)
    assert not missing, f"Missing DOM references: {sorted(missing)}"
    for asset in document.assets:
        parsed = urlsplit(asset)
        if not parsed.scheme and parsed.path:
            assert (ROOT / parsed.path).is_file(), f"Missing local asset: {asset}"
    for svg in (ROOT / "assets").rglob("*.svg"):
        ElementTree.parse(svg)
    subprocess.run(["node", "--check", str(ROOT / "js/app.js")], check=True)
    subprocess.run(["node", "--check", str(ROOT / "prototypes/pexels-inspired/prototype.js")], check=True)
    print(f"PASS: {len(document.ids)} unique IDs, all DOM references and local assets, SVG parsing, JS syntax")


if __name__ == "__main__":
    main()
