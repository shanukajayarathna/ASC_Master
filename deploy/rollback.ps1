[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9./:@_-]*$')]
    [string] $BackendImage,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9./:@_-]*$')]
    [string] $FrontendImage
)

$ErrorActionPreference = "Stop"
$compose = @("-f", "docker-compose.yml", "-f", "docker-compose.prod.yml")

$env:BACKEND_IMAGE = $BackendImage
$env:FRONTEND_IMAGE = $FrontendImage

Write-Host "Rolling back to backend $BackendImage and frontend $FrontendImage"
Write-Host "This script does not restore /data or alter MongoDB data. Follow docs/ROLLBACK.md first."

if ($PSCmdlet.ShouldProcess("Docker Compose services", "Pull and start the selected immutable images")) {
    docker compose @compose pull backend frontend caddy
    if ($LASTEXITCODE -ne 0) { throw "docker compose pull failed with exit code $LASTEXITCODE" }

    docker compose @compose up -d --no-build backend frontend caddy
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE" }

    docker compose @compose ps
    if ($LASTEXITCODE -ne 0) { throw "docker compose ps failed with exit code $LASTEXITCODE" }
}
