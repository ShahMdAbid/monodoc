import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import AdmZip from "adm-zip";
import ignore from "ignore";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON bodies
  app.use(express.json());

  // API routes FIRST
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
      
      let branch = 'main'; 
      if (paths.length >= 4 && paths[2] === 'tree') {
        branch = paths.slice(3).join('/');
      }

      const zipUrl = `https://github.com/${owner}/${repoName}/archive/refs/heads/${branch}.zip`;
      
      const githubRes = await fetch(zipUrl, {
        headers: { 'User-Agent': 'Pack-to-Markdown-App' }
      });

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
      const BINARY_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.ttf', '.woff', '.woff2', '.eot', '.mp3', '.mp4', '.pdf', '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyc', '.pyd', '.o', '.a', '.lib', '.wasm', '.bin', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];

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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
