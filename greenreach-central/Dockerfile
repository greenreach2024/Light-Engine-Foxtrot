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

# Copy recipe CSVs outside /app/data so GCS FUSE mount doesn't shadow them
RUN cp -r data/recipes-v2 /opt/recipes-v2

ENV NODE_ENV=production
ENV PORT=8080
ENV DEPLOYMENT_MODE=cloud
ENV DB_SSL=false

EXPOSE 8080

CMD ["node", "server.js"]
