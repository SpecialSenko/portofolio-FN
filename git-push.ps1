# Portfolio Git Push Helper
# Run this from Windows (not inside Docker)

Write-Host "🚀 Portfolio Git Push Helper" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "E:\Other\portofolio-FN\docker-compose.yml")) {
    Write-Host "❌ Error: Run this from E:\Other\portofolio-FN" -ForegroundColor Red
    exit 1
}

Set-Location "E:\Other\portofolio-FN"

# Check if container is running
$container = docker ps --filter "name=astro-dev" --format "{{.Names}}"
if ($container -ne "astro-dev") {
    Write-Host "❌ astro-dev container is not running!" -ForegroundColor Red
    Write-Host "Start it with: docker-compose up -d" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Container is running" -ForegroundColor Green
Write-Host ""

# Ask for repo URL
Write-Host "📝 GitHub Repository Setup" -ForegroundColor Yellow
Write-Host "Example: https://github.com/Fraxbnezl/portofolio-FN.git" -ForegroundColor White
$repoUrl = Read-Host "Enter your GitHub repository URL"

if ($repoUrl -eq "") {
    Write-Host "❌ No URL provided. Exiting..." -ForegroundColor Red
    exit 1
}

# Set remote
Write-Host ""
Write-Host "🔗 Setting up git remote..." -ForegroundColor Cyan
docker exec astro-dev git remote remove origin 2>$null
docker exec astro-dev git remote add origin $repoUrl

Write-Host "✅ Remote configured" -ForegroundColor Green
Write-Host ""

# Ask for commit message
Write-Host "💬 Commit Message" -ForegroundColor Yellow
$commitMsg = Read-Host "Enter commit message (or press Enter for 'Update portfolio')"
if ($commitMsg -eq "") {
    $commitMsg = "Update portfolio"
}

# Add and commit
Write-Host ""
Write-Host "📦 Committing changes..." -ForegroundColor Cyan
docker exec astro-dev git add .
docker exec astro-dev git commit -m "$commitMsg" 2>&1 | Write-Host

Write-Host ""
Write-Host "🚀 Ready to push!" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  IMPORTANT: You need a GitHub Personal Access Token" -ForegroundColor Yellow
Write-Host "If you don't have one:" -ForegroundColor White
Write-Host "1. Go to: https://github.com/settings/tokens" -ForegroundColor White
Write-Host "2. Generate new token (classic)" -ForegroundColor White
Write-Host "3. Select 'repo' scope" -ForegroundColor White
Write-Host "4. Copy the token (starts with ghp_)" -ForegroundColor White
Write-Host ""

$continue = Read-Host "Ready to push? (y/n)"
if ($continue -ne "y") {
    Write-Host "❌ Push cancelled" -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "🔐 GitHub Credentials" -ForegroundColor Cyan
Write-Host "When prompted:" -ForegroundColor White
Write-Host "  Username: Your GitHub username (e.g., Fraxbnezl)" -ForegroundColor White
Write-Host "  Password: Your Personal Access Token (ghp_...)" -ForegroundColor White
Write-Host ""
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
Write-Host ""

# Push (interactive - user will enter credentials)
docker exec -it astro-dev git push -u origin main

Write-Host ""
Write-Host "✅ Done! Check your GitHub repo and Vercel deployment" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Quick tips:" -ForegroundColor Yellow
Write-Host "  • Changes pushed to GitHub" -ForegroundColor White
Write-Host "  • Vercel should auto-deploy (if connected)" -ForegroundColor White
Write-Host "  • Check: https://github.com/Fraxbnezl/YOUR-REPO" -ForegroundColor White
Write-Host "  • Check: https://vercel.com/dashboard" -ForegroundColor White
