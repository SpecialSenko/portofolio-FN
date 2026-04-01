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
