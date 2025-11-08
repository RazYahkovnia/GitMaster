# Converting Icon to PNG for VS Code Marketplace

The VS Code Marketplace requires a **128x128 PNG** icon. I've created a nice SVG icon for you at:
`resources/gitmaster-icon-128.svg`

## 🎨 What the Icon Represents:
- **Blue circle background** - Professional and trustworthy
- **White branch lines** - Git branches visualization
- **Colored commit nodes** - Different authors (matching your color-coding feature!)
- **Gold star** - "Master" control and excellence

## 📝 Option 1: Online Conversion (Easiest)

1. Go to [CloudConvert](https://cloudconvert.com/svg-to-png)
2. Upload `resources/gitmaster-icon-128.svg`
3. Make sure output size is **128x128**
4. Download as `gitmaster-icon.png`
5. Save it to `resources/gitmaster-icon.png`

## 📝 Option 2: Using ImageMagick (Command Line)

If you have ImageMagick installed:

```bash
cd resources
convert -background none -size 128x128 gitmaster-icon-128.svg gitmaster-icon.png
```

## 📝 Option 3: Using Inkscape (Command Line)

If you have Inkscape installed:

```bash
cd resources
inkscape gitmaster-icon-128.svg --export-type=png --export-width=128 --export-height=128 --export-filename=gitmaster-icon.png
```

## 📝 Option 4: Online Tool (Alternative)

1. Go to [SVGtoPNG.com](https://svgtopng.com/)
2. Upload `resources/gitmaster-icon-128.svg`
3. Set size to 128x128
4. Download and save as `resources/gitmaster-icon.png`

## ✅ After Converting:

Once you have `resources/gitmaster-icon.png`, the `package.json` is already configured to use it!

Just repackage:
```bash
npm run compile
vsce package
```

Your extension will now have a beautiful icon in the marketplace! 🎉

## 🎨 Want to Customize?

You can edit `resources/gitmaster-icon-128.svg` in any SVG editor:
- [Figma](https://figma.com) (online, free)
- [Inkscape](https://inkscape.org) (desktop, free)
- [Adobe Illustrator](https://adobe.com/illustrator) (paid)

Then convert it to PNG again.

