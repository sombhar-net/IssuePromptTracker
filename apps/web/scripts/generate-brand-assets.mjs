import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, "../public/branding");

function makeMarkSvg(size, options = {}) {
  const { maskable = false } = options;
  const padding = maskable ? Math.round(size * 0.17) : Math.round(size * 0.045);
  const iconSize = size - padding * 2;
  const r = Math.round(iconSize * 0.22);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0E7665"/>
      <stop offset="100%" stop-color="#084E45"/>
    </linearGradient>
    <radialGradient id="spot" cx="0.18" cy="0.15" r="0.88">
      <stop offset="0%" stop-color="#FCD34D" stop-opacity="0.76"/>
      <stop offset="100%" stop-color="#FCD34D" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#F4F2E7"/>
  <rect x="${padding}" y="${padding}" width="${iconSize}" height="${iconSize}" rx="${r}" fill="url(#bg)"/>
  <rect x="${padding}" y="${padding}" width="${iconSize}" height="${iconSize}" rx="${r}" fill="url(#spot)"/>

  <rect x="${padding + iconSize * 0.2}" y="${padding + iconSize * 0.2}" width="${iconSize * 0.52}" height="${iconSize * 0.62}" rx="${iconSize * 0.085}" fill="#F8FFFB"/>
  <path d="M ${padding + iconSize * 0.62} ${padding + iconSize * 0.2} L ${padding + iconSize * 0.72} ${padding + iconSize * 0.3} L ${padding + iconSize * 0.62} ${padding + iconSize * 0.3} Z" fill="#D6EFEA"/>

  <rect x="${padding + iconSize * 0.26}" y="${padding + iconSize * 0.33}" width="${iconSize * 0.31}" height="${iconSize * 0.05}" rx="${iconSize * 0.02}" fill="#0A6054" opacity="0.45"/>
  <rect x="${padding + iconSize * 0.26}" y="${padding + iconSize * 0.43}" width="${iconSize * 0.24}" height="${iconSize * 0.05}" rx="${iconSize * 0.02}" fill="#0A6054" opacity="0.35"/>

  <circle cx="${padding + iconSize * 0.67}" cy="${padding + iconSize * 0.66}" r="${iconSize * 0.15}" fill="#F97316"/>
  <rect x="${padding + iconSize * 0.643}" y="${padding + iconSize * 0.59}" width="${iconSize * 0.055}" height="${iconSize * 0.12}" rx="${iconSize * 0.022}" fill="#FFF8EB"/>
  <rect x="${padding + iconSize * 0.643}" y="${padding + iconSize * 0.74}" width="${iconSize * 0.055}" height="${iconSize * 0.055}" rx="${iconSize * 0.027}" fill="#FFF8EB"/>

  <path d="M ${padding + iconSize * 0.75} ${padding + iconSize * 0.24} L ${padding + iconSize * 0.79} ${padding + iconSize * 0.33} L ${padding + iconSize * 0.89} ${padding + iconSize * 0.34} L ${padding + iconSize * 0.81} ${padding + iconSize * 0.4} L ${padding + iconSize * 0.83} ${padding + iconSize * 0.5} L ${padding + iconSize * 0.75} ${padding + iconSize * 0.45} L ${padding + iconSize * 0.67} ${padding + iconSize * 0.5} L ${padding + iconSize * 0.69} ${padding + iconSize * 0.4} L ${padding + iconSize * 0.61} ${padding + iconSize * 0.34} L ${padding + iconSize * 0.71} ${padding + iconSize * 0.33} Z" fill="#FCD34D"/>
</svg>`;
}

function makeWordmarkSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="980" height="260" viewBox="0 0 980 260" fill="none">
  <defs>
    <linearGradient id="wordBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0E7665"/>
      <stop offset="100%" stop-color="#084E45"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="980" height="260" rx="36" fill="#F4F2E7"/>
  <rect x="32" y="32" width="196" height="196" rx="42" fill="url(#wordBg)"/>
  <rect x="71" y="72" width="97" height="116" rx="13" fill="#F8FFFB"/>
  <circle cx="160" cy="168" r="30" fill="#F97316"/>
  <rect x="154" y="153" width="11" height="24" rx="4" fill="#FFF8EB"/>
  <rect x="154" y="181" width="11" height="11" rx="5.5" fill="#FFF8EB"/>
  <text x="264" y="116" fill="#0F172A" font-size="54" font-family="Sora, Segoe UI, Arial, sans-serif" font-weight="700">Issue Prompt</text>
  <text x="264" y="178" fill="#0E7665" font-size="54" font-family="Sora, Segoe UI, Arial, sans-serif" font-weight="700">Tracker</text>
  <text x="266" y="213" fill="#4B5563" font-size="23" font-family="Sora, Segoe UI, Arial, sans-serif" font-weight="500">Capture issues and ideas. Export clean AI prompts.</text>
</svg>`;
}

function makeScreenshotSvg(width, height, options = {}) {
  const { mobile = false } = options;
  const headerHeight = mobile ? 88 : 84;
  const leftColWidth = mobile ? width - 48 : Math.round(width * 0.3);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
  <defs>
    <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F7F4E8"/>
      <stop offset="100%" stop-color="#DCEBE7"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F8FFFC"/>
    </linearGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#shell)"/>
  <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="28" fill="#ECF4F1"/>

  <rect x="24" y="24" width="${leftColWidth}" height="${height - 48}" rx="20" fill="url(#card)" stroke="#CAD5D4"/>
  <rect x="${mobile ? 24 : leftColWidth + 36}" y="24" width="${mobile ? width - 48 : width - leftColWidth - 60}" height="${headerHeight}" rx="16" fill="url(#card)" stroke="#CAD5D4"/>
  <rect x="${mobile ? 24 : leftColWidth + 36}" y="${24 + headerHeight + 12}" width="${mobile ? width - 48 : width - leftColWidth - 60}" height="${height - headerHeight - 60}" rx="20" fill="url(#card)" stroke="#CAD5D4"/>

  <rect x="44" y="48" width="56" height="56" rx="12" fill="#0E7665"/>
  <circle cx="78" cy="84" r="12" fill="#F97316"/>
  <text x="118" y="78" fill="#0F172A" font-size="32" font-family="Sora, Segoe UI, Arial, sans-serif" font-weight="700">Issue Prompt Tracker</text>
  <text x="118" y="108" fill="#5C6A72" font-size="18" font-family="Sora, Segoe UI, Arial, sans-serif" font-weight="500">Projects, issues, screenshots, prompt export</text>

  <rect x="44" y="140" width="${leftColWidth - 40}" height="42" rx="11" fill="#0E7665"/>
  <rect x="44" y="196" width="${leftColWidth - 40}" height="42" rx="11" fill="#FFFFFF" stroke="#CAD5D4"/>
  <rect x="44" y="252" width="${leftColWidth - 40}" height="42" rx="11" fill="#FFFFFF" stroke="#CAD5D4"/>
  <rect x="44" y="308" width="${leftColWidth - 40}" height="42" rx="11" fill="#FFFFFF" stroke="#CAD5D4"/>

  <rect x="${mobile ? 40 : leftColWidth + 56}" y="${24 + headerHeight + 34}" width="${mobile ? width - 80 : Math.round((width - leftColWidth - 96) * 0.48)}" height="48" rx="12" fill="#FFFFFF" stroke="#CAD5D4"/>
  <rect x="${mobile ? 40 : leftColWidth + 56}" y="${24 + headerHeight + 96}" width="${mobile ? width - 80 : Math.round((width - leftColWidth - 96) * 0.48)}" height="220" rx="16" fill="#FFFFFF" stroke="#CAD5D4"/>
  <rect x="${mobile ? 40 : leftColWidth + 72}" y="${24 + headerHeight + 122}" width="${mobile ? width - 112 : Math.round((width - leftColWidth - 128) * 0.42)}" height="26" rx="8" fill="#E9F4F1"/>
  <rect x="${mobile ? 40 : leftColWidth + 72}" y="${24 + headerHeight + 160}" width="${mobile ? width - 160 : Math.round((width - leftColWidth - 188) * 0.31)}" height="26" rx="8" fill="#FEE9E9"/>

  <rect x="${mobile ? 40 : leftColWidth + 56 + (mobile ? 0 : Math.round((width - leftColWidth - 96) * 0.52))}" y="${24 + headerHeight + 34}" width="${mobile ? width - 80 : Math.round((width - leftColWidth - 96) * 0.44)}" height="282" rx="16" fill="#FFFFFF" stroke="#CAD5D4"/>
  <rect x="${mobile ? 56 : leftColWidth + 78 + (mobile ? 0 : Math.round((width - leftColWidth - 96) * 0.52))}" y="${24 + headerHeight + 58}" width="${mobile ? width - 112 : Math.round((width - leftColWidth - 154) * 0.36)}" height="20" rx="7" fill="#EAF5F2"/>
  <rect x="${mobile ? 56 : leftColWidth + 78 + (mobile ? 0 : Math.round((width - leftColWidth - 96) * 0.52))}" y="${24 + headerHeight + 90}" width="${mobile ? width - 146 : Math.round((width - leftColWidth - 220) * 0.28)}" height="20" rx="7" fill="#F7EFE1"/>
</svg>`;
}

async function writeSvg(name, contents) {
  const fullPath = path.join(outDir, name);
  await writeFile(fullPath, contents, "utf8");
  return fullPath;
}

async function writePngFromSvg(name, svg) {
  const fullPath = path.join(outDir, name);
  await sharp(Buffer.from(svg)).png().toFile(fullPath);
  return fullPath;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const markSvg = makeMarkSvg(512);
  const maskableSvg = makeMarkSvg(512, { maskable: true });
  const faviconSvg = makeMarkSvg(64);
  const wordmarkSvg = makeWordmarkSvg();
  const desktopShotSvg = makeScreenshotSvg(1280, 720, { mobile: false });
  const mobileShotSvg = makeScreenshotSvg(720, 1280, { mobile: true });

  await Promise.all([
    writeSvg("logo-mark.svg", markSvg),
    writeSvg("logo-wordmark.svg", wordmarkSvg),
    writeSvg("favicon.svg", faviconSvg),
    writePngFromSvg("apple-touch-icon.png", makeMarkSvg(180)),
    writePngFromSvg("pwa-192x192.png", makeMarkSvg(192)),
    writePngFromSvg("pwa-512x512.png", markSvg),
    writePngFromSvg("pwa-maskable-512x512.png", maskableSvg),
    writePngFromSvg("screenshot-desktop.png", desktopShotSvg),
    writePngFromSvg("screenshot-mobile.png", mobileShotSvg)
  ]);

  console.log(`Brand assets generated in ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
