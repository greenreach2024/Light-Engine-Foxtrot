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

# Copy grow-systems registry outside /app so GCS FUSE mounts over public/data
# cannot shadow it. Routes fall back to the in-repo path for local dev.
RUN cp public/data/grow-systems.json /opt/grow-systems.json

ENV NODE_ENV=production
ENV PORT=8080
ENV DEPLOYMENT_MODE=cloud
ENV DB_SSL=false

# Commit identification baked at build time so /api/version can prove
# which source SHA / branch is live. Pass with
# --build-arg GIT_SHA=$(git rev-parse HEAD)
# --build-arg GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
ARG GIT_SHA=""
ARG GIT_BRANCH=""
ENV GIT_SHA=${GIT_SHA}
ENV GIT_BRANCH=${GIT_BRANCH}

EXPOSE 8080

CMD ["node", "server.js"]
