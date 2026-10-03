ARG BUILDPLATFORM=linux/amd64
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS web-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS py-build
COPY backend/requirements.lock /tmp/requirements.lock
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential libjpeg62-turbo-dev zlib1g-dev libwebp-dev \
    && rm -rf /var/lib/apt/lists/* \
    && pip wheel --no-cache-dir --wheel-dir /wheels -r /tmp/requirements.lock

FROM python:3.12-slim-bookworm AS runtime

ARG APP_UID=10001
ARG APP_GID=10001

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FINDSTUFF_DATA_DIR=/app/data \
    FINDSTUFF_DATABASE_PATH=/app/data/findstuff.sqlite3 \
    FINDSTUFF_FRONTEND_DIST=/app/frontend/dist \
    FINDSTUFF_CONTAINER=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        poppler-utils tesseract-ocr zbar-tools \
        libjpeg62-turbo zlib1g libwebp7 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${APP_GID}" findstuff \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --home-dir /app --no-create-home findstuff

WORKDIR /app/backend
COPY backend/requirements.lock /tmp/requirements.lock
COPY --from=py-build /wheels /tmp/wheels
RUN pip install --no-index --find-links=/tmp/wheels -r /tmp/requirements.lock \
    && rm -rf /tmp/wheels

COPY --chown=findstuff:findstuff backend/findstuff/ /app/backend/findstuff/
COPY --from=web-build --chown=findstuff:findstuff /build/frontend/dist/ /app/frontend/dist/
RUN install -d -o findstuff -g findstuff -m 0750 /app/data

USER findstuff
EXPOSE 8000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3).read()"]

CMD ["uvicorn", "findstuff.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
