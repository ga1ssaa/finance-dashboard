FROM python:3.13-slim AS build
WORKDIR /build
COPY pyproject.toml ./
COPY app ./app
RUN pip wheel --no-cache-dir --wheel-dir /wheels .

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels finance-dashboard-backend \
    && rm -rf /wheels \
    && useradd --uid 10001 --create-home avero
COPY alembic.ini ./
COPY alembic ./alembic
COPY docker/migrate.py ./docker/migrate.py
USER avero
EXPOSE 8000
# A single process preserves the existing process-local authentication limiter.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
