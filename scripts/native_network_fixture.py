"""Owned, synthetic HTTP/WebSocket fixture. No account, API or production port."""
import base64
import hashlib
import http.server
import threading
import time


class Listener:
    def __init__(self):
        self.requests = []
        self.lock = threading.Lock()
        fixture = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *args):
                pass

            def do_GET(self):
                if not self.path.startswith('/h2-synthetic?window='):
                    self.send_error(404)
                    return
                websocket = self.headers.get('Upgrade', '').lower() == 'websocket'
                with fixture.lock:
                    fixture.requests.append({'path': self.path, 'kind': 'ws' if websocket else 'http',
                        'authorizationPresent': 'Authorization' in self.headers,
                        'cookiePresent': 'Cookie' in self.headers})
                if websocket:
                    key = self.headers.get('Sec-WebSocket-Key', '')
                    accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
                    self.send_response(101)
                    self.send_header('Upgrade', 'websocket')
                    self.send_header('Connection', 'Upgrade')
                    self.send_header('Sec-WebSocket-Accept', accept)
                    self.end_headers()
                    self.wfile.flush()
                    time.sleep(0.2)
                    self.wfile.write(b'\x88\x00')
                    self.wfile.flush()
                    self.close_connection = True
                else:
                    body = b'{"synthetic":"h2-owned-listener"}'
                    self.send_response(200)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.port = self.server.server_port
        assert self.port not in (8787, 8788)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        assert not self.thread.is_alive()

    def snapshot(self):
        with self.lock:
            return list(self.requests)
