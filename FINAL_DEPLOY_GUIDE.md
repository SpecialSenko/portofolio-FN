# COMPLETE GITHUB & VERCEL DEPLOYMENT GUIDE


---

# GitHub Repository Creation & Deployment Guide

This document combines repository creation, GitHub push, and Vercel deployment instructions into a single guide.

---

# Create GitHub Repository - Quick Steps

## Step 1: Create Repository on GitHub

1. Open: https://github.com/new
2. Fill in:
   - **Repository name:** `portofolio-FN`
   - **Description:** My Portfolio Website - Built with Astro
   - **Visibility:** ✅ Public (required for free Vercel hosting)
   - **Initialize repository:** 
     - ❌ DO NOT add README
     - ❌ DO NOT add .gitignore
     - ❌ DO NOT choose a license
     (You already have these files)
3. Click **"Create repository"**

## Step 2: Push Your Code

After creating the repo, run this PowerShell script:

```powershell
cd E:\Other\portofolio-FN
.\push-now.ps1
```

Or manually:

```powershell
docker exec astro-dev git push -u origin main
```

When prompted:
- Username: `Fraxbnezl`
- Password: your GitHub personal access token

## Step 3: Verify

Check your repo: https://github.com/Fraxbnezl/portofolio-FN

You should see all your files there!

## Next: Deploy to Vercel

1. Go to: https://vercel.com
2. Sign in with GitHub
3. Click "New Project"
4. Import `Fraxbnezl/portofolio-FN`
5. Click "Deploy"

Done! Your site will be live at: `https://portofolio-fn.vercel.app`


---

# 🚀 Deploy Portfolio to Public Website

## Current Situation
✅ Your portfolio runs locally in Docker (http://localhost:4321)
❌ Not yet pushed to GitHub
❌ Not yet deployed to public website

## The Easy Way: 3 Steps

### Step 1: Get GitHub Personal Access Token (PAT)

1. Go to: **https://github.com/settings/tokens**
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Settings:
   - Name: `Portfolio Deploy`
   - Expiration: `No expiration`
   - Scopes: ✅ **repo** (check this box)
4. Click **"Generate token"**
5. **COPY IT NOW** (starts with `ghp_...`) - you won't see it again!

**Save it somewhere safe!**

---

### Step 2: Push to GitHub

Open PowerShell on your Windows machine:

```powershell
cd E:\Other\portofolio-FN
.\git-push.ps1
```

The script will:
1. Ask for your GitHub repo URL
2. Ask for a commit message
3. Push to GitHub

When it asks for credentials:
- **Username:** `Fraxbnezl`
- **Password:** Paste your PAT token (`ghp_...`)

---

### Step 3: Deploy to Vercel (Public Website)

#### Option A: Auto-Deploy (Recommended)

1. Go to **https://vercel.com**
2. Sign in with GitHub
3. Click **"Add New Project"**
4. Import your repository: `Fraxbnezl/portofolio-FN`
5. Framework: Astro (auto-detected)
6. Click **"Deploy"**

**Done!** Every time you push to GitHub, Vercel auto-deploys your site.

#### Option B: Vercel CLI

```powershell
npm i -g vercel
cd E:\Other\portofolio-FN
vercel --prod
```

---

## Alternative: Manual Push (Inside Container)

If you prefer to work inside the Docker container:

```bash
# Enter container
docker exec -it astro-dev sh

# Fix git remote (replace with your actual repo)
git remote remove origin
git remote add origin https://github.com/Fraxbnezl/portofolio-FN.git

# Check it's correct
git remote -v

# Quick push
./push.sh

# Or manual:
git add .
git commit -m "Update portfolio"
git push -u origin main
```

When asked:
- Username: `Fraxbnezl`
- Password: `ghp_...` (your PAT token)

---

## What Your Repo URL Should Look Like

❌ Wrong: `https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git`
✅ Correct: `https://github.com/Fraxbnezl/portofolio-FN.git`

Create the repo on GitHub first if it doesn't exist:
1. Go to https://github.com/new
2. Name: `portofolio-FN`
3. Make it Public (for free Vercel hosting)
4. Don't add README or .gitignore (you already have them)
5. Click Create

---

## Workflow After Setup

Every time you make changes:

```powershell
# From Windows
cd E:\Other\portofolio-FN
.\git-push.ps1
```

Or:

```bash
# Inside container
./push.sh
```

Changes appear on your public website in ~2 minutes!

---

## Troubleshooting

**"Authentication failed"**
- You're using your GitHub password (wrong!)
- Use your Personal Access Token instead

**"remote: Invalid username or token"**
- Your PAT token is wrong or expired
- Generate a new one: https://github.com/settings/tokens

**"fatal: 'origin' does not appear to be a git repository"**
- Fix with: `git remote add origin https://github.com/Fraxbnezl/portofolio-FN.git`

**Can't enter container**
- Try: `winpty docker exec -it astro-dev sh`
- Or use the PowerShell script instead

**Vercel not deploying**
- Check: https://vercel.com/dashboard
- Reconnect GitHub repo in Vercel settings

---

## Files Created to Help You

- `GITHUB_DEPLOY.md` - Detailed guide
- `git-push.ps1` - Windows PowerShell helper
- `push.sh` - Inside container helper

---

## Summary

1. Create PAT: https://github.com/settings/tokens
2. Run: `.\git-push.ps1`
3. Connect Vercel: https://vercel.com
4. Done! Auto-deploys on every push

**Your public website will be:** `https://your-repo-name.vercel.app`

---

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
