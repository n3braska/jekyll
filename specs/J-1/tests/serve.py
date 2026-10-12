"""Static server for the J-1 test pages (parser.html, cms.html). Run from the repo root:

    python3 specs/J-1/tests/serve.py [port]

Same as `python3 -m http.server`, but serves .yml as YAML, which Decap CMS requires for its config.
"""
import http.server
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({'.yml': 'text/yaml', '.yaml': 'text/yaml'})
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
