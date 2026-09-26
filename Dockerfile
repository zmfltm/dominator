FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir 'yt-dlp[default]' \
 && npm install --global pnpm@11.25.0
ENV PATH="/opt/yt-dlp/bin:${PATH}"
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
USER node
ENV DOMINATOR_HOST=0.0.0.0
EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
