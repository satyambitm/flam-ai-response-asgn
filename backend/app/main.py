import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import router
from app.api.schemas import ErrorBody, ErrorEnvelope
from app.config import Settings, get_settings
from app.core.errors import AppError, ErrorKind
from app.core.ratelimit import RateLimiter
from app.providers.factory import build_providers

log = logging.getLogger("app")


def error_response(err: AppError) -> JSONResponse:
    body = ErrorEnvelope(
        error=ErrorBody(kind=err.kind, message=err.message, retryable=err.retryable, retryAfter=err.retry_after)
    )
    headers = {"Retry-After": str(err.retry_after)} if err.retry_after else None
    return JSONResponse(body.model_dump(mode="json"), status_code=err.status, headers=headers)


def _compact_validation(exc: RequestValidationError) -> str:
    parts = [f"{'.'.join(map(str, e['loc'][1:])) or 'body'}: {e['msg']}" for e in exc.errors()[:5]]
    return "Invalid request. " + "; ".join(parts)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    for noisy in ("httpx", "httpx2", "google_genai"):  # one INFO line per HTTP call is noise; we log per request
        logging.getLogger(noisy).setLevel(logging.WARNING)

    app = FastAPI(title="Structured AI backend", version="0.1.0")
    app.state.settings = settings
    app.state.providers = build_providers(settings)
    app.state.limiter = RateLimiter(settings.rate_limit_per_min)

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(AppError(ErrorKind.INPUT, _compact_validation(exc)))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        resp = error_response(AppError(ErrorKind.INPUT, str(exc.detail)))
        resp.status_code = exc.status_code
        return resp

    # Registered before CORS so it sits *inside* it: crash responses still get CORS headers,
    # otherwise the browser would report a 500 as an opaque network error.
    @app.middleware("http")
    async def _catch_all(request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            log.exception("unhandled error on %s %s", request.method, request.url.path)
            return error_response(AppError(ErrorKind.INTERNAL, "Something went wrong on our side."))

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Fault"],
    )
    app.include_router(router)
    providers = app.state.providers
    chain = " -> ".join(f"{p.name}:{p.model}" for p in providers.chain) or "mock"
    log.info(
        "started chain=%s selectable=%s faults=%s cors=%s",
        chain,
        ",".join(providers.available) or "mock",
        settings.allow_faults,
        settings.cors_origin_list,
    )
    return app


app = create_app()
