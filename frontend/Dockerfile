# Build context is frontend/ (see docker-compose.yml at the repo root).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# NEXT_PUBLIC_* values are baked in at build time (Next.js inlines them into the client
# bundle) — pass the real backend URL as a build arg, not a runtime env var.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:5058
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN npm run build

# next.config.ts sets output: "standalone", so the build above already produced a
# self-contained server at .next/standalone — no node_modules needed in the runtime image.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Weekly FACT report PDFs (api/weekly-fact/pdf/route.ts) are produced by converting the real
# .xlsx through LibreOffice headless, so the output matches Excel's own Export-to-PDF exactly —
# libreoffice-calc is the Alpine package with the pieces that conversion needs; the DejaVu fonts
# avoid missing-glyph fallback since the workbooks' fonts (Calibri/Arial) aren't in the base image.
RUN apk add --no-cache libreoffice-calc ttf-dejavu

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
