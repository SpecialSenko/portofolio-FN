# GitHub Setup Guide - Deploy Your Portfolio

## Problem
GitHub doesn't accept passwords anymore. You need a Personal Access Token (PAT).

## Step 1: Create Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Give it a name: `Portfolio Deploy`
4. Set expiration: `No expiration` (or your preference)
5. Select scopes:
   - ✅ **repo** (full control of private repositories)
6. Click **"Generate token"**
7. **COPY THE TOKEN** (you won't see it again!)

Save it somewhere safe like: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Step 2: Fix Your Git Remote

Inside the Docker container (`/app #`), run these commands:

```bash
# Remove the wrong remote
git remote remove origin

# Add correct remote with YOUR actual repo URL
# Replace YOUR-USERNAME and YOUR-REPO-NAME with real values
git remote add origin https://github.com/Fraxbnezl/YOUR-REPO-NAME.git

# Check if correct
git remote -v
```

## Step 3: Push to GitHub

```bash
# Push to GitHub
git push -u origin main
```

When prompted:
- **Username:** `Fraxbnezl`
- **Password:** `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (your PAT token)

## Step 4: Deploy to Vercel (for public website)

Your portfolio should be on Vercel (based on `.vercel` folder in your project).

### Option A: Auto-deploy (Recommended)

1. Go to: https://vercel.com
2. Sign in with GitHub
3. Import your repository: `Fraxbnezl/YOUR-REPO-NAME`
4. Click **Deploy**
5. Done! Every git push auto-deploys

### Option B: Manual Deploy

```bash
# Inside container
npm run build

# Or outside container (host machine)
cd E:\Other\portofolio-FN
docker exec astro-dev npm run build
```

Then upload `dist/` folder to Vercel.

## Quick Commands

### Push changes from Docker container:
```bash
# Inside container (/app #)
git add .
git commit -m "Update portfolio"
git push origin main
```

### Push changes from Windows:
```powershell
# On host machine
cd E:\Other\portofolio-FN
docker exec astro-dev git add .
docker exec astro-dev git commit -m "Update portfolio"
docker exec astro-dev git push origin main
```

## What Happens Next?

1. You push to GitHub → Code updated on GitHub
2. Vercel detects push → Automatically builds and deploys
3. Your public website updates in ~2 minutes

## Your Current Status

✅ Git configured (Fraxb, alfathsaki22@gmail.com)
✅ Files committed
✅ Branch renamed to main
❌ Need correct repo URL
❌ Need Personal Access Token

## Fix Now:

```bash
# Inside Docker container, run:
git remote remove origin
git remote add origin https://github.com/Fraxbnezl/portofolio-FN.git
git push -u origin main
# Enter username: Fraxbnezl
# Enter password: [YOUR PAT TOKEN]
```
