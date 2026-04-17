# GreenReach Central - Cloud Run
# Connects to AlloyDB via private IP through VPC connector
FROM node:20-slim

WORKDIR /app

# Install Python3 + R + scientific stacks for GWEN execute_code tool
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-numpy python3-pandas python3-scipy python3-matplotlib \
      r-base r-base-dev r-cran-ggplot2 r-cran-dplyr r-cran-lme4 r-cran-nlme r-cran-survival \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN node - <<'NODE'
const fs = require('fs');
const path = require('path');

const files = [
  'calibration.json',
  'crop-pricing.json',
  'crop-registry.json',
  'device-kb.json',
  'device-manufacturers.json',
  'equipment.catalog.json',
  'equipment-kb.json',
  'equipment-metadata.json',
  'spd-library-default.json',
  'spd-library.json',
];

const sourceDir = path.join(process.cwd(), 'public', 'data');
const manifestPath = path.join(process.cwd(), 'shared-public-data.generated.json');
const manifest = {};

for (const fileName of files) {
  manifest[fileName] = fs.readFileSync(path.join(sourceDir, fileName), 'utf8');
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest));
NODE

# Copy shared JSON assets outside /app so runtime mounts cannot shadow them
RUN mkdir -p /opt/shared-data && cp -r public/data/. /opt/shared-data/

# Copy recipe CSVs outside /app/data so GCS FUSE mount doesn't shadow them
RUN cp -r data/recipes-v2 /opt/recipes-v2

ENV NODE_ENV=production
ENV PORT=8080
ENV DEPLOYMENT_MODE=cloud
ENV DB_SSL=false

EXPOSE 8080

CMD ["node", "server.js"]
