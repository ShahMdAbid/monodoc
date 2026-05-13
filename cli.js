#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import ignore from 'ignore';

// 1. Setup ignoring rules & Binary filters
const BINARY_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.ttf', '.woff', '.woff2', '.eot', '.mp3', '.mp4', '.pdf', '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyc', '.pyd', '.o', '.a', '.lib', '.wasm', '.bin', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];
const DEFAULT_IGNORES = ['.git', 'node_modules', 'dist', 'build', '.DS_Store', 'coverage', 'monodoc_output.md'];

// --- NEW: Parse Command Line Arguments ---
const args = process.argv.slice(2);
let customIgnores = [];

// Look for 'remove', '--ignore', or '--exclude'
const keywordIndex = args.findIndex(arg => arg === 'remove' || arg === '--ignore' || arg === '--exclude');
if (keywordIndex !== -1) {
  // Grab everything after the keyword
  customIgnores = args.slice(keywordIndex + 1);
}
// ----------------------------------------

const cwd = process.cwd();
const ig = ignore().add(DEFAULT_IGNORES);

if (fs.existsSync(path.join(cwd, '.gitignore'))) {
  ig.add(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8'));
}

// --- NEW: Add custom ignores to the engine ---
if (customIgnores.length > 0) {
  console.log(` Excluding custom files/patterns: ${customIgnores.join(', ')}`);
  ig.add(customIgnores);
}
// ---------------------------------------------

// 2. Directory Tree Generator
function generateDirectoryTree(paths) {
  const tree = {};
  for (const p of paths) {
    const parts = p.split('/');
    let current = tree;
    for (const part of parts) {
      if (!current[part]) current[part] = {};
      current = current[part];
    }
  }
  let result = '';
  const buildTreeString = (node, prefix = '') => {
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const isLast = i === keys.length - 1;
      result += prefix + (isLast ? '└── ' : '├── ') + key + '\n';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      buildTreeString(node[key], childPrefix);
    }
  };
  buildTreeString(tree);
  return result;
}

// 3. Walk the file system
const filesToPack = [];
function walk(dir) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(cwd, fullPath).replace(/\\/g, '/');

    // Check against ALL ignores (.gitignore + default + custom commands)
    if (ig.ignores(relPath)) continue;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else {
      const ext = path.extname(file).toLowerCase();
      if (!BINARY_EXTENSIONS.includes(ext)) {
        filesToPack.push(relPath);
      }
    }
  }
}

// 4. Execute
console.log('MonoDoc is scanning your directory...');
walk(cwd);

if (filesToPack.length === 0) {
  console.log('No text files found to pack.');
  process.exit(0);
}
console.log(`Packing ${filesToPack.length} files...`);

let output = '## Directory Structure\n\n```text\n';
output += generateDirectoryTree(filesToPack);
output += '```\n\n';

for (const file of filesToPack) {
  const content = fs.readFileSync(path.join(cwd, file), 'utf8');
  const extMatch = file.match(/\.[^.]+$/);
  const ext = extMatch ? extMatch[0].toLowerCase().replace('.', '') : '';
  output += `### ${file}\n\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
}
fs.writeFileSync('monodoc_output.md', output);
console.log('Success! Created \x1b[32mmonodoc_output.md\x1b[0m in your current folder.');