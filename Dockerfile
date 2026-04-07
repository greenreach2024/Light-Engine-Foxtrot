# Light Engine (LE) - Cloud Run
# Mirrors EB prebuild hooks: npm ci + Python ML deps
FROM node:20-slim

# Python for ML anomaly detection (scikit-learn, numpy, pandas, statsmodels)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages --no-cache-dir \
    "scikit-learn>=1.4.0" \
    "numpy>=1.26.0" \
    "pandas>=2.2.0" \
    "statsmodels>=0.14.0" \
    "requests>=2.31.0"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Runtime data dirs -- Cloud Run volume mount overlays /app/data
# for persistence. Without volume, data resets on cold start.
RUN mkdir -p /app/data /app/public/data

ENV NODE_ENV=production
ENV PORT=8080
ENV DEPLOYMENT_MODE=cloud

EXPOSE 8080

CMD ["node", "server-foxtrot.js"]
