import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.deps import csrf_protect
from app.api.limiter import limiter
from app.api.v1 import auth, health, passkeys, progress, settings, team
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.core.setup_token import setup_token
from app.db.queries import no_users
from app.db.session import SessionLocal

log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        with SessionLocal() as db:
            empty = no_users(db)
    except SQLAlchemyError:  # tables missing (migrations not run): the first request will say so
        log.warning("Database not ready at start")
        empty = False
    token, generated = setup_token()
    if empty and generated:  # a token chosen by the operator is never logged
        log.warning("No account yet. Setup token for the first account: %s", token)
    yield


def create_app() -> FastAPI:
    setup_logging()
    config = get_settings()
    dev = config.environment == "development"
    app = FastAPI(
        title="Enshrouded map API",
        docs_url="/api/docs" if dev else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if dev else None,
        dependencies=[Depends(csrf_protect)],
        lifespan=lifespan,
    )
    app.state.limiter = limiter

    @app.middleware("http")
    async def limit_body(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > config.max_body_bytes:
            return JSONResponse({"detail": "too_large"}, status_code=413)
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, __: RequestValidationError) -> JSONResponse:
        return JSONResponse({"detail": "invalid_request"}, status_code=422)  # never echo input

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    @app.exception_handler(RateLimitExceeded)
    async def too_many(_: Request, __: RateLimitExceeded) -> JSONResponse:
        return JSONResponse({"detail": "too_many_requests"}, status_code=429)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled", extra={"path": request.url.path, "error": type(exc).__name__})
        return JSONResponse({"detail": "internal"}, status_code=500)

    for module in (health, auth, passkeys, progress, settings, team):
        app.include_router(module.router, prefix="/api/v1")
    return app


app = create_app()
