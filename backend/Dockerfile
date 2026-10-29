FROM python:3.12.16-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt --no-cache-dir

COPY . .

RUN useradd "appuser" -m

# Local SQLite lives here. docker-compose.yml mounts a named volume on it, and
# a new volume copies this folder's owner, so the non-root user can write.
RUN mkdir /data && chown "appuser" /data

USER "appuser"

EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "app:app"]