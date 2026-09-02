import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const docsDir = path.resolve('docs');
const outputDir = path.resolve('dist');

console.log('Starting Fast SPA Build Pipeline...');

// 1. FIRST: Generate navigation.json inside docs/
try {
  execSync('node build_navigation.mjs', { stdio: 'inherit' });
} catch (e) {
  console.error('Error generating navigation.json:', e);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 2. Copy public assets
const docsPublic = path.join(docsDir, 'public');
const distPublic = path.join(outputDir, 'public');
if (fs.existsSync(docsPublic)) {
  fs.cpSync(docsPublic, distPublic, { recursive: true });
}

const rootPublic = path.resolve('public');
if (fs.existsSync(rootPublic)) {
  fs.cpSync(rootPublic, distPublic, { recursive: true });
}

// 3. Clear and Copy docs folder to dist/docs excluding .git
const distDocs = path.join(outputDir, 'docs');
if (fs.existsSync(distDocs)) {
  fs.rmSync(distDocs, { recursive: true, force: true });
}

if (fs.existsSync(docsDir)) {
  fs.cpSync(docsDir, distDocs, {
    recursive: true,
    filter: (src) => !src.includes('.git')
  });
}

// 4. Copy index.html template to dist/index.html
const indexHtmlPath = path.resolve('index.html');
const distIndexHtml = path.join(outputDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  fs.copyFileSync(indexHtmlPath, distIndexHtml);
}

// 5. Ensure navigation.json is copied to both dist/navigation.json and dist/docs/navigation.json
const navSrc = path.join(docsDir, 'navigation.json');
if (fs.existsSync(navSrc)) {
  fs.copyFileSync(navSrc, path.join(outputDir, 'navigation.json'));
  fs.copyFileSync(navSrc, path.join(distDocs, 'navigation.json'));
}

console.log('Fast SPA Build Completed Successfully!');