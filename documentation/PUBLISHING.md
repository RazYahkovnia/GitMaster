# Publishing GitMaster to VS Code Marketplace

## Prerequisites

1. **Microsoft/Azure Account**: You need a Microsoft or Azure DevOps account
2. **Publisher Account**: Create a publisher on the VS Code Marketplace
3. **Personal Access Token (PAT)**: Required for authentication

## Step-by-Step Guide

### 1. Update Package.json

✅ **Already done!** Make sure to update these placeholders:
- `"publisher"`: Change `"your-publisher-name"` to your actual publisher ID
- `"author"`: Add your name
- `"repository"`: Update with your GitHub repository URL
- `"bugs"`: Update with your GitHub issues URL
- `"homepage"`: Update with your GitHub README URL

### 2. Create a Publisher Account

1. Go to [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
2. Sign in with your Microsoft/Azure DevOps account
3. Click **"Create Publisher"**
4. Fill in:
   - **Publisher ID**: Unique identifier (e.g., `razya`, `john-doe`)
   - **Display Name**: Your name or company name
   - **Description**: Brief description about you

### 3. Get a Personal Access Token (PAT)

1. Go to [Azure DevOps](https://dev.azure.com/)
2. Click on your profile icon → **Security** → **Personal Access Tokens**
3. Click **"New Token"**
4. Configure:
   - **Name**: `vscode-marketplace`
   - **Organization**: All accessible organizations
   - **Expiration**: Custom (1 year recommended)
   - **Scopes**: Click "Show all scopes" → Select **"Marketplace" → "Manage"**
5. Click **"Create"**
6. **IMPORTANT**: Copy the token immediately (you won't see it again!)

### 4. Install vsce (VS Code Extension Manager)

```bash
npm install -g @vscode/vsce
```

### 5. Prepare Your Extension

#### A. Create an Icon (128x128 PNG)

Convert your SVG icon to PNG:
```bash
# If you have ImageMagick installed:
convert -background none -size 128x128 resources/gitmaster-icon.svg resources/gitmaster-icon.png

# Or use an online converter like:
# https://cloudconvert.com/svg-to-png
```

#### B. Create a README.md

Create a comprehensive README with:
- Features description
- Screenshots/GIFs
- Installation instructions
- Usage guide
- Configuration options

#### C. Create a LICENSE file

```bash
# For MIT License:
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2024 Your Name

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
```

#### D. Create a .vscodeignore file

```bash
cat > .vscodeignore << 'EOF'
.vscode/**
.vscode-test/**
src/**
.gitignore
.yarnrc
vsc-extension-quickstart.md
**/tsconfig.json
**/.eslintrc.json
**/*.map
**/*.ts
node_modules/**
.cursorrules
ARCHITECTURE.md
CODE_GUIDE.md
REFACTORING_SUMMARY.md
PUBLISHING.md
EOF
```

### 6. Build and Package

```bash
# Compile TypeScript
npm run compile

# Package the extension (creates .vsix file)
vsce package
```

This creates a `gitmaster-0.0.1.vsix` file.

### 7. Test Locally (Optional but Recommended)

```bash
# Install the .vsix file in VS Code
code --install-extension gitmaster-0.0.1.vsix
```

Test thoroughly before publishing!

### 8. Publish to Marketplace

#### Option A: Publish with vsce CLI

```bash
# Login (you'll be asked for your PAT token)
vsce login your-publisher-name

# Publish
vsce publish
```

#### Option B: Publish Manually

1. Go to [Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
2. Click on your publisher name
3. Click **"New Extension"** → **"Visual Studio Code"**
4. Upload your `.vsix` file
5. Fill in any additional information
6. Click **"Upload"**

### 9. Update Version for Future Releases

```bash
# Patch version (0.0.1 -> 0.0.2)
vsce publish patch

# Minor version (0.0.1 -> 0.1.0)
vsce publish minor

# Major version (0.0.1 -> 1.0.0)
vsce publish major

# Or specify version
vsce publish 0.1.0
```

## Quick Publish Commands

```bash
# First time setup
npm install -g @vscode/vsce
vsce login your-publisher-name

# Every time you want to publish
npm run compile
vsce publish patch
```

## Verification

After publishing, your extension will be available at:
```
https://marketplace.visualstudio.com/items?itemName=your-publisher-name.gitmaster
```

Users can install it by searching "GitMaster" in VS Code Extensions or:
```bash
code --install-extension your-publisher-name.gitmaster
```

## Important Notes

1. **Review Process**: Extensions are automatically scanned but manual review may occur
2. **Update Time**: Changes may take 5-10 minutes to appear in the marketplace
3. **Statistics**: Track downloads, ratings, and reviews in the publisher management portal
4. **Updates**: Users get automatic updates when you publish new versions
5. **Unpublish**: You can unpublish anytime from the management portal

## Troubleshooting

### "Publisher 'your-publisher-name' not found"
- Create a publisher account first
- Use `vsce login` with your actual publisher ID

### "Missing repository field"
- Add repository URL to package.json

### "Missing icon"
- Create a 128x128 PNG icon
- Add `"icon": "resources/gitmaster-icon.png"` to package.json

### "Invalid Personal Access Token"
- Ensure you selected "Marketplace → Manage" scope
- Token must not be expired
- Use `vsce logout` then `vsce login` again

## Next Steps After Publishing

1. ⭐ Add screenshots to your README
2. 📝 Write detailed documentation
3. 🎥 Create demo GIFs/videos
4. 🐛 Set up GitHub Issues for bug reports
5. 📢 Share on social media, Reddit, Twitter
6. 💬 Engage with user feedback and reviews
7. 🔄 Regular updates and new features

Good luck with your extension! 🚀

