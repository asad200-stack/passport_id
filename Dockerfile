# One link for customer: app + API from same origin. Build from repo root.
FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages rembg

WORKDIR /app
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/index.js ./
COPY index.html app.js styles.css config.js public/

RUN mkdir -p tmp
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
