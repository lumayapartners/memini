# Runs the memini MCP server (stdio). Used by MCP inspectors/registries (e.g. Glama)
# to boot the server for introspection; not the recommended install path for users —
# that's `npx -y memini init` in a repo.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev
# the server stores memories under the working directory when no git repo is present
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["mcp"]
