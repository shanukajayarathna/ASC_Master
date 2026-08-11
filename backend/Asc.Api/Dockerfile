# Build context is backend/ (see docker-compose.yml at the repo root).
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Restore first, from just the csproj, so dependency layers cache across code-only changes.
# Only Asc.Api.csproj is copied — Asc.Api.Tests is never part of a runtime image.
COPY Asc.Api/Asc.Api.csproj Asc.Api/
RUN dotnet restore Asc.Api/Asc.Api.csproj

COPY Asc.Api/ Asc.Api/
RUN dotnet publish Asc.Api/Asc.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# ContentRootPath defaults to WORKDIR, and SaleFileStore/LocalDocumentStore/LocalLotMediaStore
# all resolve their data directory as "<ContentRootPath>/../../data" (a convention that, in the
# local dev layout, walks up from backend/Asc.Api to the repo root). With WORKDIR=/app that
# same relative walk lands on /data — mount a persistent volume there for sale Excel imports,
# uploaded documents, and lot media to survive a container restart (see docker-compose.yml).
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "Asc.Api.dll"]
