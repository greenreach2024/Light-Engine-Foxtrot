# GreenReach Central - Cloud Run
# Connects to AlloyDB via private IP through VPC connector
FROM node:20-slim

WORKDIR /app

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
