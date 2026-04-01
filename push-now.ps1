# Auto-push script without an embedded token
# Prompts for a GitHub PAT at runtime and cleans up after itself.

Write-Host "Pushing portfolio to GitHub..." -ForegroundColor Cyan
Write-Host ""

Set-Location "D:\portofolio-FN"

$container = docker ps --filter "name=astro-dev" --format "{{.Names}}"
if ($container -ne "astro-dev") {
    Write-Host "astro-dev container is not running." -ForegroundColor Red
    Write-Host "Start it with: docker-compose up -d" -ForegroundColor Yellow
    exit 1
}

$secureToken = Read-Host "GitHub Personal Access Token" -AsSecureString
$tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)

try {
    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-Host "No token provided." -ForegroundColor Red
        exit 1
    }

    $gitCredHelper = @"
#!/bin/sh
echo username=SpecialSenko
echo password=$token
"@

    $gitCredHelper | docker exec -i astro-dev sh -c 'cat > /tmp/git-cred-helper.sh && chmod +x /tmp/git-cred-helper.sh'
    docker exec astro-dev git config credential.helper '/tmp/git-cred-helper.sh'

    Write-Host ""
    Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
    docker exec astro-dev git push -u origin main 2>&1 | Write-Host

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Successfully pushed to GitHub." -ForegroundColor Green
        Write-Host "Check: https://github.com/SpecialSenko/portofolio-FN" -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "Push failed." -ForegroundColor Red
    }
}
finally {
    docker exec astro-dev git config --unset credential.helper 2>$null
    docker exec astro-dev rm -f /tmp/git-cred-helper.sh 2>$null
    if ($tokenPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr)
    }
}
