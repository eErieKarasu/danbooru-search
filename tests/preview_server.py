"""Deterministic UI smoke-test server. Run from the repo root on port 4174.

The served app points to this server's /posts.json instead of Danbooru.
Production files on disk are never modified. Illustrations are local test media.
Use tags fixture_error, fixture_slow, fixture_empty to test exceptional states.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json
import time

ROOT = Path(__file__).resolve().parents[1]
SIZES = [(640, 880), (800, 580), (640, 790), (640, 920), (640, 720), (800, 600),
         (640, 880), (640, 680), (640, 900), (800, 600), (640, 840), (640, 760)]
TAG_SETS = ["scenery mountain sky river", "scenery ocean sky", "scenery night moon sky",
            "scenery field sunset sky", "scenery cloud sky", "scenery desert sunset sky"]


def posts():
    result = []
    for index, (width, height) in enumerate(SIZES):
        post_id = 910001 + index
        tags = TAG_SETS[index % len(TAG_SETS)]
        # Last thumbnail exercises image-error UI.
        media = f"/prototypes/pexels-inspired/assets/scene-{index+1:02}.svg" if index < 11 else "/missing-image.svg"
        result.append({
            "id": post_id, "image_width": width, "image_height": height,
            "rating": ["g", "g", "s", "g", "q", "e"][index % 6],
            "score": 100 - index, "fav_count": 20 + index,
            "tag_string_general": tags, "tag_string_artist": "fixture_artist",
            "tag_string": tags + " fixture_artist", "tag_string_character": "",
            "tag_string_copyright": "", "file_ext": "png", "file_size": 102400,
            "preview_file_url": media, "large_file_url": media, "file_url": media,
        })
    return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        request = urlparse(self.path)
        if request.path == "/__mobile":
            width = 320 if parse_qs(request.query).get("width") == ["320"] else 390
            page = f'''<!doctype html><meta charset="utf-8"><title>手机回归 {width}px</title>
                <style>body{{margin:0;background:#e9ece6;text-align:center;padding:12px}}
                p{{font:12px system-ui;color:#5f7154}}iframe{{width:{width}px;height:844px;border:0;border-radius:12px;background:white}}</style>
                <p>固定测试数据 · {width}px 手机布局</p><iframe title="手机布局" src="/"></iframe>'''
            return self.send_body(200, page.encode(), "text/html; charset=utf-8")
        if request.path in {"/", "/index.html"}:
            page = (ROOT / "index.html").read_text().replace(
                '<body data-view="home">',
                '<body data-view="home"><p style="margin:0;padding:5px 16px;text-align:center;background:#edf3e7;color:#66765b;font-size:10px">本地回归测试 · 固定测试数据</p>')
            return self.send_body(200, page.encode(), "text/html; charset=utf-8")
        if request.path == "/js/app.js":
            source = (ROOT / "js/app.js").read_text().replace(
                'const DANBOORU_BASE_URL = "https://danbooru.donmai.us";',
                'const DANBOORU_BASE_URL = window.location.origin;')
            return self.send_body(200, source.encode(), "text/javascript")
        if request.path == "/posts.json":
            params = parse_qs(request.query)
            tags = params.get("tags", [""])[0].split()
            if "fixture_error" in tags:
                return self.send_body(400, b"Fixture network failure", "text/plain")
            if "fixture_slow" in tags:
                time.sleep(8)
            items = [] if "fixture_empty" in tags or params.get("page", ["1"])[0] != "1" else posts()
            for tag in tags:
                if tag.startswith(("order:", "fixture_")):
                    continue
                if tag.startswith("-"):
                    items = [item for item in items if tag[1:] not in item["tag_string"].split()]
                else:
                    items = [item for item in items if tag in item["tag_string"].split()]
            return self.send_body(200, json.dumps(items).encode(), "application/json")
        return super().do_GET()

    def send_body(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    print("UI fixture preview: http://127.0.0.1:4174", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 4174), Handler).serve_forever()
