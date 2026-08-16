FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FACEOPS_DATA_DIR=/data \
    FACEOPS_DATABASE_PATH=/data/faceops.sqlite3 \
    FACEOPS_MODEL_ROOT=/models

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 g++ gcc python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY server ./server
COPY tests ./tests
COPY index.html app.js styles.css tokens.css ./

RUN mkdir -p /data /models

EXPOSE 8000

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
