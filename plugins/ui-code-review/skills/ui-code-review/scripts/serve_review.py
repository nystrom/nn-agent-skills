#!/usr/bin/env python3
"""
Serve the ui-code-review three-pane app and its live review state.

Usage:
    python serve_review.py state.json [--port 8899] [--host 127.0.0.1]

Routes:
    GET /            -> the app shell (from render_app.build_page, live mode)
    GET /state.json  -> the current contents of the state file, re-read on every
                        request. The page polls this ~every 1.5s, so rewriting the
                        state file (e.g. after the agent applies a fix and the diff
                        changes) is what refreshes the diff view — no restart needed.

The skill starts this once in the background, prints the URL, and then just
overwrites the state file as the review advances. Stdlib only; binds to loopback
by default. This is a local review viewer, not a public server.
"""
import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_app import build_page  # noqa: E402


def make_handler(state_path):
    page = build_page(state=None, live=True)  # rendered once; data comes from /state.json
    page_bytes = page.encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, body, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html"):
                self._send(200, page_bytes, "text/html; charset=utf-8")
            elif path == "/state.json":
                try:
                    with open(state_path, "rb") as f:
                        data = f.read()
                    json.loads(data)  # guard against serving a half-written file
                    self._send(200, data, "application/json; charset=utf-8")
                except (OSError, ValueError):
                    self._send(200, b'{"title":"Code review","changes":[],"current":null}',
                               "application/json; charset=utf-8")
            else:
                self._send(404, b"not found", "text/plain; charset=utf-8")

        def log_message(self, *args):  # keep the terminal quiet
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description="Serve the ui-code-review app + live state.")
    ap.add_argument("state", help="Path to the review state JSON the page polls.")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    state_path = os.path.abspath(args.state)
    if not os.path.exists(state_path):  # start empty so the page loads before the first write
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump({"title": "Code review", "changes": [], "current": None}, f)

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(state_path))
    print(f"ui-code-review serving http://{args.host}:{args.port}  (state: {state_path})")
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
