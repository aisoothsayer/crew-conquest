FROM node:24.19.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY game/package*.json ./game/
COPY game/packages ./game/packages
RUN cd game && npm ci --ignore-scripts --include=dev
COPY game ./game
COPY crew-runtime ./crew-runtime
COPY Dockerfile .dockerignore ./
RUN cd game && CREW_TWITCH_ONLY=true CREW_BUILD_ID=CREW-20261012-10 GIT_COMMIT=CREW-20261012-10 GAME_ENV=dev API_DOMAIN= npm run build-prod
RUN zip -qr game/static/crew-source.zip game crew-runtime Dockerfile .dockerignore -x 'game/node_modules/*' 'game/static/*' 'game/.git/*' 'game/.env*' 'game/resources/public/crew-source.zip' 'game/proprietary/*'
ENV NODE_ENV=production NUM_WORKERS=1 PORT=10000
EXPOSE 10000
CMD ["node", "crew-runtime/start-hosted.cjs"]
