#!/bin/sh
# Quick Git Push Script
# Run this inside the Docker container

echo "🚀 Quick Git Push"
echo "================="
echo ""

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "❌ Git not initialized. Run: git init"
    exit 1
fi

# Get current remote
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null)

if [ "$CURRENT_REMOTE" = "YOUR_GITHUB_REPO_URL" ] || [ -z "$CURRENT_REMOTE" ]; then
    echo "⚠️  Git remote not configured correctly"
    echo ""
    echo "Run these commands:"
    echo "  git remote remove origin"
    echo "  git remote add origin https://github.com/Fraxbnezl/YOUR-REPO-NAME.git"
    echo ""
    exit 1
fi

echo "📍 Remote: $CURRENT_REMOTE"
echo ""

# Ask for commit message
echo "💬 Commit message (or press Enter for 'Update portfolio'):"
read -r COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="Update portfolio"
fi

# Git operations
echo ""
echo "📦 Adding files..."
git add .

echo "💾 Committing..."
git commit -m "$COMMIT_MSG"

echo ""
echo "🚀 Pushing to GitHub..."
echo ""
echo "⚠️  When prompted:"
echo "  Username: Fraxbnezl"
echo "  Password: [Your Personal Access Token]"
echo ""

git push -u origin main

echo ""
echo "✅ Done!"
