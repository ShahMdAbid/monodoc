import serverless from 'serverless-http';
import express from 'express';
import AdmZip from 'adm-zip';
import ignore from 'ignore';
import path from 'path';

const app = express();
app.use(express.json());

app.post('/api/pack', async (req, res) => {
  const { url } = req.body;

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
    
    let branch = 'main'; 
    
    if (paths.length >= 4 && paths[2] === 'tree') {
      branch = paths.slice(3).join('/');
    }

    const zipUrl = `https://api.github.com/repos/${owner}/${repoName}/zipball/${branch}`;

    const githubRes = await fetch(zipUrl, {
      headers: {
        'User-Agent': 'Pack-to-Markdown-App'
      }
    });

    if (!githubRes.ok) {
      if (githubRes.status === 404) {
        return res.status(404).json({ error: 'Repository not found or is private.' });
      }
      if (githubRes.status === 403) {
        return res.status(403).json({ error: 'Rate limit exceeded access forbidden.' });
      }
      return res.status(githubRes.status).json({ error: `GitHub API responded with status ${githubRes.status}` });
    }

    const arrayBuffer = await githubRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: 'Repository too large. Maximum supported size is 50MB.' });
    }

    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();
    
    const files: { path: string; content: string; size: number }[] = [];
    
    const BINARY_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.ttf', '.woff', '.woff2', '.eot', '.mp3', '.mp4', '.pdf', '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyc', '.pyd', '.o', '.a', '.lib', '.wasm', '.bin'];
    const HARDCODED_IGNORE = ['node_modules/', '.git/', '.next/', 'dist/', 'build/'];
    
    let gitignoreContent = '';
    for (const entry of zipEntries) {
      if (!entry.isDirectory) {
        const pathParts = entry.entryName.split('/');
        pathParts.shift(); 
        const cleanPath = pathParts.join('/');
        if (cleanPath === '.gitignore') {
          gitignoreContent = entry.getData().toString('utf8');
          break;
        }
      }
    }

    const ig = ignore();
    if (gitignoreContent) {
      ig.add(gitignoreContent);
    }

    let totalTextSize = 0;
    const MAX_TEXT_SIZE = 5 * 1024 * 1024; // 5 MB

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      
      const pathParts = entry.entryName.split('/');
      pathParts.shift(); // Remove the top-level repo directory
      const cleanPath = pathParts.join('/');

      if (HARDCODED_IGNORE.some(ignoredPath => cleanPath.startsWith(ignoredPath) || cleanPath.includes(`/${ignoredPath}`))) continue;

      const ext = path.extname(cleanPath).toLowerCase();
      if (BINARY_EXTENSIONS.includes(ext)) continue;

      let isIgnored = false;
      try {
          isIgnored = ig.ignores(cleanPath);
      } catch(e) {}
      
      if (isIgnored) continue;

      const content = entry.getData().toString('utf8');
      
      const size = Buffer.byteLength(content, 'utf8');
      totalTextSize += size;
      if (totalTextSize > MAX_TEXT_SIZE) {
        return res.status(413).json({ error: 'Repository too large. Maximum supported text size is 5MB.' });
      }

      files.push({
        path: cleanPath,
        content,
        size
      });
    }

    return res.json({ 
      message: 'Successfully extracted repository.',
      data: {
        owner,
        repoName,
        branch,
        filesCount: files.length,
        files
      }
    });
  } catch (error: any) {
    console.error('Error processing repository:', error);
    return res.status(400).json({ error: 'Invalid URL format or processing failed.' });
  }
});

export const handler = serverless(app);
