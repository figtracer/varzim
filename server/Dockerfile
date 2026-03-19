FROM oven/bun:1 AS base
WORKDIR /app

COPY server/package.json server/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY server/ .

ENV PORT=3002
EXPOSE 3002

CMD ["bun", "run", "index.ts"]
