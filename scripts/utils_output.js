const fs = require('fs');
const path = require('path');

function getDefaultDesktopDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.USERPROFILE || '', 'Desktop');
  }
  const home = process.env.HOME || '';
  const xdg = process.env.XDG_DESKTOP_DIR;
  if (xdg && path.isAbsolute(xdg)) return xdg;
  return path.join(home, 'Desktop');
}

function getDateFolderName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function ensureDir(dirPath) {
  try {
    await fs.promises.access(dirPath);
  } catch {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }
  return dirPath;
}

function resolveOutputDir(cliDir) {
  let baseDir;
  if (cliDir != null && String(cliDir).trim() !== '') {
    baseDir = path.resolve(String(cliDir).trim());
  } else {
    const env = process.env.DOUBAO_OUTPUT_DIR;
    if (env != null && String(env).trim() !== '') {
      baseDir = path.resolve(String(env).trim());
    } else {
      baseDir = getDefaultDesktopDir();
    }
  }
  // 按日期创建子目录
  const dateFolder = getDateFolderName();
  return path.join(baseDir, dateFolder);
}

function slugFromPrompt(prompt, maxLen = 36) {
  const s = String(prompt)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .slice(0, maxLen);
  return s || 'doubao';
}

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function extFromUrl(url) {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname.split('?')[0] || '');
    const m = base.match(/\.(jpe?g|png|gif|webp|mp4|webm|mov)(\b|$)/i);
    if (m) return '.' + m[1].toLowerCase().replace('jpeg', 'jpg');
  } catch (_) {}
  return null;
}

function extFromContentType(ct) {
  if (!ct) return '.bin';
  const t = ct.split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  return map[t] || '.bin';
}

async function saveUrlToFile(url, destPath, page) {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  if (page) {
    try {
      const res = await page.request.get(url, { timeout: 180000 });
      if (res.ok()) {
        const buf = await res.body();
        await fs.promises.writeFile(destPath, buf);
        return destPath;
      }
    } catch (_) {}
  }

  const fetchFn = typeof fetch === 'function' ? fetch : null;
  if (!fetchFn) {
    throw new Error('需要 Node.js 18+ 的全局 fetch 以下载资源');
  }

  const res = await fetchFn(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; doubao-skills)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
  const ct = res.headers.get('content-type');
  await fs.promises.writeFile(destPath, Buffer.from(await res.arrayBuffer()));

  if (path.extname(destPath) === '.bin' && ct) {
    const ext = extFromContentType(ct);
    if (ext !== '.bin') {
      const renamed = destPath.replace(/\.bin$/i, ext);
      await fs.promises.rename(destPath, renamed);
      return renamed;
    }
  }
  return destPath;
}

async function downloadImages(page, imageUrls, outputDir, prompt) {
  // 确保目录存在
  await ensureDir(outputDir);
  const slug = slugFromPrompt(prompt);
  const ts = timestampForFilename();
  const paths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const u = imageUrls[i];
    const ext = extFromUrl(u) || '.png';
    const base = `doubao-image_${ts}_${slug}_${i + 1}${ext}`;
    const dest = path.join(outputDir, base);
    const saved = await saveUrlToFile(u, dest, page);
    paths.push(saved);
  }
  return paths;
}

async function downloadVideoAssets(page, { videoUrl, thumbnailUrl, downloadUrl, outputDir, prompt }) {
  // 确保目录存在
  await ensureDir(outputDir);
  const slug = slugFromPrompt(prompt);
  const ts = timestampForFilename();
  const out = {};

  const primary = downloadUrl || videoUrl;
  if (primary) {
    const ext = extFromUrl(primary) || '.mp4';
    const dest = path.join(outputDir, `doubao-video_${ts}_${slug}${ext}`);
    out.videoPath = await saveUrlToFile(primary, dest, page);
  }

  if (thumbnailUrl && thumbnailUrl !== primary) {
    const ext = extFromUrl(thumbnailUrl) || '.jpg';
    const dest = path.join(outputDir, `doubao-video_${ts}_${slug}_thumb${ext}`);
    try {
      out.thumbnailPath = await saveUrlToFile(thumbnailUrl, dest, page);
    } catch (_) {}
  }

  return out;
}

module.exports = {
  getDefaultDesktopDir,
  getDateFolderName,
  ensureDir,
  resolveOutputDir,
  slugFromPrompt,
  timestampForFilename,
  saveUrlToFile,
  downloadImages,
  downloadVideoAssets,
};
