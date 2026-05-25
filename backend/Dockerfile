FROM python:3.12-slim

# OpenCV needs these system libraries even with the headless wheel
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Persistent dirs (mounted as volumes in docker-compose)
RUN mkdir -p /app/data /app/uploads
ENV DATA_DIR=/app/data
ENV UPLOAD_DIR=/app/uploads

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
