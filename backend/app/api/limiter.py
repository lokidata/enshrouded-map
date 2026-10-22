from slowapi import Limiter
from slowapi.util import get_remote_address

# Client address comes from X-Forwarded-For only when uvicorn trusts the proxy
# (FORWARDED_ALLOW_IPS), see app/main.py. In-memory counters: run a single worker.
limiter = Limiter(key_func=get_remote_address)
