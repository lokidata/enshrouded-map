"""Map server: serves the static map and a small API for user accounts and progress.

Usage: python server.py [--host 0.0.0.0] [--port 8765] [--db ../data/users.db]

Only the Python standard library is used (http.server + sqlite3).

API (JSON):
  POST   /api/register   {username, password}  create an account and log in
  POST   /api/login      {username, password}  log in (session cookie)
  POST   /api/logout                           end the session
  GET    /api/me                               {username} (null when logged out)
  GET    /api/progress                         {marks: [id, ...]}
  PUT    /api/progress   {ids: [...], done: bool}  mark / unmark elements
  GET    /api/settings                         {settings: {...} or null}  saved page state (filters)
  PUT    /api/settings   {settings: {...}}     save it

Passwords are stored as salted PBKDF2-SHA256 hashes; sessions are random
tokens kept hashed in the database and sent as an HttpOnly, SameSite=Strict
cookie. Write requests must be JSON, which together with SameSite blocks
cross-site requests. Failed logins are rate limited per client address.
"""
import argparse
import gzip
import hashlib
import io
import hmac
import json
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
SESSION_DAYS = 30
PBKDF2_ROUNDS = 240_000
USERNAME = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
MIN_PASSWORD = 6
MARK_ID = re.compile(r"^[A-Za-z]+:-?\d+:-?\d+$")
MAX_MARKS = 200_000
MAX_BODY = 4_000_000
MAX_SETTINGS = 256_000   # bytes of JSON per user
LOGIN_FAILURES = (10, 300)   # at most 10 failed logins per 5 minutes and address
NOT_SERVED = re.compile(r"(?i)\.(py|db|sqlite)$|(^|/)\.")
# Browser cache lifetimes (seconds) by path prefix; other files are revalidated
# on each load (ETag, answered with 304 when unchanged).
CACHE_LIFETIMES = [("tiles/", 86400), ("icons/", 86400), ("biomes.png", 86400)]
COMPRESSIBLE = {".js", ".html", ".css", ".json", ".svg"}


class Store:
    """SQLite storage for users, sessions and progress marks."""

    def __init__(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.path = path
        self.lock = threading.Lock()
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL,
                    salt BLOB NOT NULL, hash BLOB NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash BLOB PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS settings (
                    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    data TEXT NOT NULL, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS marks (
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, mark TEXT NOT NULL,
                    created REAL NOT NULL, PRIMARY KEY (user_id, mark));
            """)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA foreign_keys = ON")
        return db

    @staticmethod
    def hash_password(password, salt):
        return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)

    def create_user(self, username, password):
        salt = secrets.token_bytes(16)
        with self.lock, self.connect() as db:
            try:
                cur = db.execute("INSERT INTO users (username, salt, hash, created) VALUES (?, ?, ?, ?)",
                                 (username, salt, self.hash_password(password, salt), time.time()))
            except sqlite3.IntegrityError:
                return None
            return cur.lastrowid

    def check_user(self, username, password):
        with self.connect() as db:
            row = db.execute("SELECT id, salt, hash FROM users WHERE username = ?", (username,)).fetchone()
        if not row:
            self.hash_password(password, b"0" * 16)  # same cost whether the user exists or not
            return None
        user_id, salt, stored = row
        return user_id if hmac.compare_digest(self.hash_password(password, salt), stored) else None

    def new_session(self, user_id):
        token = secrets.token_urlsafe(32)
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                       (hashlib.sha256(token.encode()).digest(), user_id, time.time() + SESSION_DAYS * 86400))
        return token

    def session_user(self, token):
        if not token:
            return None
        with self.connect() as db:
            row = db.execute(
                "SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE token_hash = ? AND expires > ?", (hashlib.sha256(token.encode()).digest(), time.time())
            ).fetchone()
        return row

    def end_session(self, token):
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).digest(),))

    def marks(self, user_id):
        with self.connect() as db:
            return [r[0] for r in db.execute("SELECT mark FROM marks WHERE user_id = ? ORDER BY created", (user_id,))]

    def settings(self, user_id):
        with self.connect() as db:
            row = db.execute("SELECT data FROM settings WHERE user_id = ?", (user_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def set_settings(self, user_id, data):
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO settings VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET "
                       "data = excluded.data, updated = excluded.updated", (user_id, data, time.time()))

    def set_marks(self, user_id, ids, done):
        with self.lock, self.connect() as db:
            if done:
                count = db.execute("SELECT COUNT(*) FROM marks WHERE user_id = ?", (user_id,)).fetchone()[0]
                if count + len(ids) > MAX_MARKS:
                    return False
                db.executemany("INSERT OR IGNORE INTO marks VALUES (?, ?, ?)",
                               [(user_id, i, time.time()) for i in ids])
            else:
                db.executemany("DELETE FROM marks WHERE user_id = ? AND mark = ?", [(user_id, i) for i in ids])
        return True


class RateLimit:
    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.failures = {}
        self.lock = threading.Lock()

    def blocked(self, key):
        with self.lock:
            recent = [t for t in self.failures.get(key, []) if t > time.time() - self.window]
            self.failures[key] = recent
            return len(recent) >= self.limit

    def fail(self, key):
        with self.lock:
            self.failures.setdefault(key, []).append(time.time())


class Handler(SimpleHTTPRequestHandler):
    store = None
    limiter = RateLimit(*LOGIN_FAILURES)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # keep connections open: one TCP connection per browser socket instead
    # of one per file
    protocol_version = "HTTP/1.1"
    gzip_cache = {}
    gzip_lock = threading.Lock()

    # --- static files ---------------------------------------------------
    def send_head(self):
        """Static files with ETag revalidation, cache lifetimes and gzip."""
        url_path = self.path.split("?")[0].split("#")[0]
        if NOT_SERVED.search(url_path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            if not url_path.endswith("/"):
                return super().send_head()  # redirect to the trailing slash
            path = os.path.join(path, "index.html")
        try:
            st = os.stat(path)
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
        max_age = next((age for prefix, age in CACHE_LIFETIMES if url_path.lstrip("/").startswith(prefix)), 0)
        cache_control = f"public, max-age={max_age}" if max_age else "no-cache"

        if self.headers.get("If-None-Match") == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache_control)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        ext = os.path.splitext(path)[1].lower()
        gzipped = ext in COMPRESSIBLE and "gzip" in self.headers.get("Accept-Encoding", "")
        if gzipped:
            body = self.gzipped(path, st.st_mtime_ns)
            stream, length = io.BytesIO(body), len(body)
        else:
            stream, length = open(path, "rb"), st.st_size
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Length", str(length))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache_control)
        if ext in COMPRESSIBLE:
            self.send_header("Vary", "Accept-Encoding")
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        return stream

    @classmethod
    def gzipped(cls, path, mtime):
        """Compressed file content, cached until the file changes."""
        with cls.gzip_lock:
            cached = cls.gzip_cache.get(path)
            if cached and cached[0] == mtime:
                return cached[1]
        with open(path, "rb") as f:
            body = gzip.compress(f.read(), compresslevel=6)
        with cls.gzip_lock:
            cls.gzip_cache[path] = (mtime, body)
        return body

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    # --- helpers -------------------------------------------------------
    def json_reply(self, status, payload, cookie=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie["session"].value if "session" in cookie else None

    def current_user(self):
        return self.store.session_user(self.session_token())

    def read_body(self):
        """Reads the whole request body (needed on kept-alive connections)."""
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True   # do not read megabytes for nothing
            return None
        return self.rfile.read(length) if length else b""

    def read_json(self):
        raw = self.read_body()
        if raw is None or not self.headers.get("Content-Type", "").startswith("application/json"):
            return None
        try:
            return json.loads(raw or b"{}")
        except ValueError:
            return None

    @staticmethod
    def session_cookie(token, max_age):
        return f"session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}"

    # --- API -----------------------------------------------------------
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/me":
            user = self.current_user()
            # 200 either way: not being logged in is a normal state for the page
            return self.json_reply(200, {"username": user[1] if user else None})
        if path in ("/api/progress", "/api/settings"):
            user = self.current_user()
            if not user:
                return self.json_reply(401, {"error": "login"})
            if path == "/api/settings":
                return self.json_reply(200, {"settings": self.store.settings(user[0])})
            return self.json_reply(200, {"marks": self.store.marks(user[0])})
        if path.startswith("/api/"):
            return self.json_reply(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/logout":
            self.read_body()
            token = self.session_token()
            if token:
                self.store.end_session(token)
            return self.json_reply(200, {}, cookie=self.session_cookie("", 0))
        body = self.read_json()
        if body is None:
            return self.json_reply(400, {"error": "json"})
        if path in ("/api/register", "/api/login"):
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", ""))
            client = self.client_address[0]
            if path == "/api/register":
                if not USERNAME.match(username):
                    return self.json_reply(400, {"error": "username"})
                if len(password) < MIN_PASSWORD:
                    return self.json_reply(400, {"error": "password"})
                user_id = self.store.create_user(username, password)
                if user_id is None:
                    return self.json_reply(409, {"error": "taken"})
            else:
                if self.limiter.blocked(client):
                    return self.json_reply(429, {"error": "too many attempts"})
                user_id = self.store.check_user(username, password)
                if user_id is None:
                    self.limiter.fail(client)
                    return self.json_reply(401, {"error": "credentials"})
            token = self.store.new_session(user_id)
            return self.json_reply(200, {"username": username},
                                   cookie=self.session_cookie(token, SESSION_DAYS * 86400))
        return self.json_reply(404, {"error": "not found"})

    def do_PUT(self):
        body = self.read_json()
        path = self.path.split("?")[0]
        if path not in ("/api/progress", "/api/settings"):
            return self.json_reply(404, {"error": "not found"})
        user = self.current_user()
        if not user:
            return self.json_reply(401, {"error": "login"})
        if path == "/api/settings":
            settings = body.get("settings") if isinstance(body, dict) else None
            data = json.dumps(settings, ensure_ascii=False, separators=(",", ":"))
            if not isinstance(settings, dict) or len(data) > MAX_SETTINGS:
                return self.json_reply(400, {"error": "settings"})
            self.store.set_settings(user[0], data)
            return self.json_reply(200, {})
        ids = body.get("ids") if isinstance(body, dict) else None
        if not isinstance(ids, list) or not all(isinstance(i, str) and MARK_ID.match(i) for i in ids) or len(ids) > 50_000:
            return self.json_reply(400, {"error": "ids"})
        if not self.store.set_marks(user[0], ids, bool(body.get("done", True))):
            return self.json_reply(413, {"error": "too many marks"})
        return self.json_reply(200, {})

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)


class DualStackServer(ThreadingHTTPServer):
    """IPv6 socket that also accepts IPv4 (every interface)."""
    address_family = socket.AF_INET6
    daemon_threads = True

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


class IPv6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True


class IPv4Server(ThreadingHTTPServer):
    daemon_threads = True


def make_servers(host, port):
    """Servers for the requested host.

    Browsers on Windows try "localhost" as ::1 first: listening on IPv4 only
    costs ~300 ms on every new connection, so both families are served.
    """
    if host in ("0.0.0.0", "::", ""):
        return [DualStackServer(("::", port), Handler)]
    if host in ("127.0.0.1", "localhost", "::1"):
        servers = [IPv4Server(("127.0.0.1", port), Handler)]
        try:
            servers.append(IPv6Server(("::1", port), Handler))
        except OSError:
            pass  # no IPv6 loopback
        return servers
    return [(IPv6Server if ":" in host else IPv4Server)((host, port), Handler)]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="0.0.0.0",
                        help="address to listen on: 0.0.0.0 = whole network (IPv4 and IPv6), localhost = this PC only")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", default=os.path.join(ROOT, "..", "data", "users.db"))
    args = parser.parse_args()
    Handler.store = Store(args.db)
    servers = make_servers(args.host, args.port)
    print(f"Map on http://localhost:{args.port} (listening on {', '.join(s.server_address[0] for s in servers)}; "
          f"database {os.path.abspath(args.db)})")
    for server in servers[1:]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
