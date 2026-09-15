"""Local app preview without the surrounding Jekyll theme."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[2])
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] in ['/molecule-visualizer/', '/molecule-visualizer/index.html']:
            source = Path('molecule-visualizer/index.html').read_text().split('---', 2)[2]
            source = '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body>' + source + '</body></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(source.encode())
        else:
            super().do_GET()
ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
