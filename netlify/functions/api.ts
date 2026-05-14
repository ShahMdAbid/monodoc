import serverless from 'serverless-http';
import express from 'express';
import AdmZip from 'adm-zip';
import ignore from 'ignore';
import path from 'path';

const app = express();
app.use(express.json());

app.post("/api/pack", async (req, res) => {
  // 1. Accept customIgnorePatterns from the frontend
  const { url, customIgnorePatterns = [] } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required.' });
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'github.com') {
      return res.status(400).json({ error: 'Only github.com URLs are supported.' });
    }

    const paths = parsedUrl.pathname.split('/').filter(Boolean);
    if (paths.length < 2) {
      return res.status(400).json({ error: 'Invalid GitHub repository URL.' });
    }

    const owner = paths[0];
    const repoName = paths[1].endsWith('.git') ? paths[1].slice(0, -4) : paths[1];
    let branch = ''; 

    // Setup auth header if you add a token to your .env later (highly recommended to avoid rate limits)
    const fetchHeaders: Record<string, string> = { 'User-Agent': 'Pack-to-Markdown-App' };
    if (process.env.GITHUB_TOKEN) {
      fetchHeaders['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    // 1. Determine the branch
    if (paths.length >= 4 && paths[2] === 'tree') {
      // User provided a specific branch in the URL
      branch = paths.slice(3).join('/');
    } else {
      // Fetch default branch from GitHub API
      try {
        const repoMetaRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
          headers: fetchHeaders
        });
        if (repoMetaRes.ok) {
          const repoMeta = await repoMetaRes.json();
          branch = repoMeta.default_branch || 'main';
        } else {
          branch = 'main'; // Fallback if API fails
        }
      } catch (e) {
        branch = 'main'; // Fallback on network error
      }
    }

    // 2. Try fetching the zip
    let zipUrl = `https://github.com/${owner}/${repoName}/archive/refs/heads/${branch}.zip`;
    let githubRes = await fetch(zipUrl, { headers: fetchHeaders });

    // 3. Fallback: If 'main' fails and the user didn't explicitly request a branch, try 'master'
    if (githubRes.status === 404 && !(paths.length >= 4 && paths[2] === 'tree') && branch === 'main') {
      branch = 'master';
      zipUrl = `https://github.com/${owner}/${repoName}/archive/refs/heads/${branch}.zip`;
      githubRes = await fetch(zipUrl, { headers: fetchHeaders });
    }

    if (!githubRes.ok) {
      if (githubRes.status === 404) return res.status(404).json({ error: 'Repository not found or is private.' });
      if (githubRes.status === 403) return res.status(403).json({ error: 'Rate limit exceeded.' });
      return res.status(githubRes.status).json({ error: `GitHub API responded with status ${githubRes.status}` });
    }

    const arrayBuffer = await githubRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: 'Repository too large. Maximum supported size is 50MB.' });
    }

    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();
    const allPaths: string[] = [];
    const files: { path: string; content: string; size: number }[] = [];
    const BINARY_EXTENSIONS = [
      // Images
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp', '.tiff', '.avif',
      // Fonts
      '.ttf', '.woff', '.woff2', '.eot', '.otf',
      // Audio/Video
      '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.webm',
      // Archives & Executables
      '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyc', '.pyd', '.o', '.a', '.lib', '.wasm', '.bin',
      // Documents & Ebooks
      '.pdf', '.epub', '.mobi', '.azw3', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.rtf', '.odt', '.ods', '.odp',
      // Database / Local state
      '.sqlite', '.sqlite3', '.db', '.bak'
    ];

    let gitignoreContent = '';
    for (const entry of zipEntries) {
      if (!entry.isDirectory) {
        const cleanPath = entry.entryName.split('/').slice(1).join('/');
        if (cleanPath === '.gitignore') {
          gitignoreContent = entry.getData().toString('utf8');
          break;
        }
      }
    }

    // 2. Initialize ignore engine with BOTH gitignore AND user's settings
    const ig = ignore();
    if (gitignoreContent) ig.add(gitignoreContent);
    if (customIgnorePatterns.length > 0) ig.add(customIgnorePatterns);

    let totalTextSize = 0;
    const MAX_TEXT_SIZE = 5 * 1024 * 1024; 

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      
      const cleanPath = entry.entryName.split('/').slice(1).join('/');

      // 3. Let the ignore package handle EVERYTHING natively (no more HARDCODED_IGNORE array!)
      let isIgnored = false;
      try {
          isIgnored = ig.ignores(cleanPath);
      } catch(e) {}
      
      if (isIgnored) continue;

      allPaths.push(cleanPath);

      const ext = path.extname(cleanPath).toLowerCase();
      if (BINARY_EXTENSIONS.includes(ext)) continue;

      const content = entry.getData().toString('utf8');
      const size = Buffer.byteLength(content, 'utf8');
      totalTextSize += size;

      if (totalTextSize > MAX_TEXT_SIZE) {
        return res.status(413).json({ error: 'Repository too large. Maximum supported text size is 5MB.' });
      }

      files.push({ path: cleanPath, content, size });
    }

    return res.json({ 
      message: 'Successfully extracted repository.',
      data: { owner, repoName, branch, totalFilesCount: allPaths.length, allPaths, filesCount: files.length, files }
    });

  } catch (error: any) {
    console.error('Error processing repository:', error);
    return res.status(400).json({ error: 'Invalid URL format or processing failed.' });
  }
});

export const handler = serverless(app);
