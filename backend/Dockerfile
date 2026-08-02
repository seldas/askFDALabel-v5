FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HOST=0.0.0.0
ENV BACKEND_PORT=8842

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Optimize pip with a BuildKit cache mount
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip \
    && pip install -r requirements.txt


# Use wildcard COPY to make fda_internal_ca.crt optional, avoiding build failure if absent
COPY fda_internal_ca.crt* /usr/local/share/ca-certificates/
RUN if [ -f /usr/local/share/ca-certificates/fda_internal_ca.crt ]; then update-ca-certificates; fi

COPY . .

EXPOSE 8842

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${BACKEND_PORT:-8842} --workers ${GUNICORN_WORKERS:-4} --threads ${GUNICORN_THREADS:-8} --worker-class gthread --timeout 600 app:app"]
