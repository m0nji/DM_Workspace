# DM Workspace Agent Instructions

## BrandDesign App Icons

- App icons must use the shared DM BrandDesign system from /Users/thomas/Projects/DM_BrandDesign.
- Check /Users/thomas/Projects/DM_BrandDesign/packages/assets/icons/workspace-color-modern-source.svg before changing icon geometry, colors, or effects.
- Keep the editable macOS/source art at 1024x1024 with the BrandDesign safe area: the squircle is x=100, y=100, width=824, height=824.
- Windows exports must be full-bleed compared with the macOS source. Keep WIN_FILL at about 1.214 and include explicit .ico frames for taskbar sizes.
- Do not redraw the icon locally. Update the BrandDesign source first, then regenerate app assets from that source.

## App Icon Generation

- Source SVG: build/icon-master.svg.
- Regenerate all platform app icons with node build/generate-icons.mjs.
- macOS uses build/icon.icns; Windows uses build/icon.ico; Linux/runtime resources use build/icon.png and build/icons/.
