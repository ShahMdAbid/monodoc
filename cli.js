#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import ignore from 'ignore';

const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp', '.tiff', '.avif',
  '.ttf', '.woff', '.woff2', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.webm',
  '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyc', '.pyd', '.o', '.a', '.lib', '.wasm', '.bin',
  '.pdf', '.epub', '.mobi', '.azw3', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.rtf', '.odt', '.ods', '.odp',
  '.sqlite', '.sqlite3', '.db', '.bak'
];
const DEFAULT_IGNORES = ['.git', 'node_modules', 'dist', 'build', '.DS_Store', 'coverage', 'monodoc_output.md', 'monodoc_output.xml'];

// --- Formatting Helpers ---
const stripEmptyLines = (text) => text ? text.replace(/^\s*[\r\n]/gm, '') : '';

const injectLineNumbers = (text) => {
  if (!text) return text;
  const lines = text.split('\n');
  const maxDigits = String(lines.length).length;
  return lines.map((line, index) => {
    const lineNumber = String(index + 1).padStart(maxDigits, ' ');
    return `${lineNumber} | ${line}`;
  }).join('\n');
};

const stripComments = (text, ext) => {
  if (!text) return text;
  const lowerExt = ext.toLowerCase();

  try {
    if (['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.swift', '.php', '.css'].includes(lowerExt)) {
      // Group 1: Strings. Group 2 (Uncaptured): Comments.
      const regex = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/.*/g;
      return text.replace(regex, (match, stringLiteral) => stringLiteral ? match : '');
    }
    if (['.py', '.rb', '.sh', '.yaml', '.yml', '.dockerfile', '.pl'].includes(lowerExt)) {
      const regex = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|#.*/g;
      return text.replace(regex, (match, stringLiteral) => stringLiteral ? match : '');
    }
    if (['.html', '.xml', '.md', '.vue', '.svelte'].includes(lowerExt)) {
      const regex = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|<!--[\s\S]*?-->/g;
      return text.replace(regex, (match, stringLiteral) => stringLiteral ? match : '');
    }
  } catch (e) {
    // Failsafe: if a massive minified file breaks the regex, return original text safely
    return text;
  }
  return text;
};

// --- Parse Arguments ---
const args = process.argv.slice(2);
let customIgnores = [];
let targetPaths = [];
let options = { noComments: false, noEmpty: false, lineNumbers: false, xml: false };

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--ignore' || arg === '--exclude' || arg === 'remove') {
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
      // Consume ONLY the next argument (split by comma for multiple)
      customIgnores.push(...args[++i].split(','));
    }
  } else if (arg.startsWith('--ignore=')) {
    customIgnores.push(...arg.split('=')[1].split(','));
  } else if (arg === '--no-comments') {
    options.noComments = true;
  } else if (arg === '--no-empty') {
    options.noEmpty = true;
  } else if (arg === '--line-numbers') {
    options.lineNumbers = true;
  } else if (arg === '--xml') {
    options.xml = true;
  } else if (!arg.startsWith('-')) {
    targetPaths.push(arg); // Specific files or folders to pack
  }
}

const cwd = process.cwd();
const ig = ignore().add(DEFAULT_IGNORES);

if (fs.existsSync(path.join(cwd, '.gitignore'))) {
  try { ig.add(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')); } catch (e) { }
}
if (customIgnores.length > 0) {
  console.log(`Excluding custom patterns: ${customIgnores.join(', ')}`);
  ig.add(customIgnores);
}

// Default to current directory if no specific files provided
if (targetPaths.length === 0) targetPaths.push('.');

// --- File Scanning ---
const allPaths = [];
const filesToPack = [];

function walk(targetPath) {
  const absolutePath = path.resolve(cwd, targetPath);
  if (!fs.existsSync(absolutePath)) {
    console.log(`Warning: Could not find path -> ${targetPath}`);
    return;
  }

  const stat = fs.statSync(absolutePath);
  const relPath = path.relative(cwd, absolutePath).replace(/\\/g, '/');

  // Enforce ignore rules
  if (relPath && ig.ignores(relPath)) return;

  if (stat.isDirectory()) {
    const list = fs.readdirSync(absolutePath);
    for (const file of list) {
      walk(path.join(absolutePath, file));
    }
  } else {
    // Fallback to targetPath if relPath is empty (rare edge case)
    const finalPath = relPath || targetPath;
    allPaths.push(finalPath);

    const ext = path.extname(absolutePath).toLowerCase();
    if (!BINARY_EXTENSIONS.includes(ext)) {
      filesToPack.push(finalPath);
    }
  }
}

console.log('MonoDoc is scanning your files...');
for (const target of targetPaths) walk(target);

if (filesToPack.length === 0) {
  console.log('No text files found to pack. Check your paths and ignore rules.');
  process.exit(0);
}

console.log(`Packing ${filesToPack.length} files...`);

// --- Generate Output ---
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
      buildTreeString(node[key], prefix + (isLast ? '    ' : '│   '));
    }
  };
  buildTreeString(tree);
  return result;
}

const notesBlock = `<notes>
- Some files may have been excluded based on .gitignore rules and monodoc's configuration
- Binary files are not included in this packed representation.
</notes>\n\n`;

let output = '';
const outputFile = options.xml ? 'monodoc_output.xml' : 'monodoc_output.md';

if (options.xml) {
  output += `<?xml version="1.0" encoding="UTF-8"?>\n<repository>\n`;
  output += notesBlock;
  output += `  <directory_structure>\n<![CDATA[\n${generateDirectoryTree(allPaths)}\n]]>\n  </directory_structure>\n`;
  output += `  <files>\n`;

  for (const file of filesToPack) {
    let content = fs.readFileSync(path.join(cwd, file), 'utf8');
    const ext = path.extname(file);
    if (options.noComments) content = stripComments(content, ext);
    if (options.noEmpty) content = stripEmptyLines(content);
    if (options.lineNumbers) content = injectLineNumbers(content);

    const safeContent = content.replace(/]]>/g, ']]]]><![CDATA[>');
    output += `    <file path="${file}">\n<![CDATA[\n${safeContent}\n]]>\n    </file>\n`;
  }
  output += `  </files>\n</repository>\n`;

} else {
  output += notesBlock;
  output += '## Directory Structure\n\n```text\n';
  output += generateDirectoryTree(allPaths);
  output += '```\n\n';

  const extensionToLanguage = {
    '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.cpp': 'cpp',
    '.html': 'html', '.css': 'css', '.json': 'json', '.md': 'markdown', '.sh': 'bash'
  };

  for (const file of filesToPack) {
    let content = fs.readFileSync(path.join(cwd, file), 'utf8');
    const extMatch = file.match(/\.[^.]+$/);
    const ext = extMatch ? extMatch[0].toLowerCase() : '';
    const lang = extensionToLanguage[ext] || ext.replace('.', '');

    if (options.noComments) content = stripComments(content, ext);
    if (options.noEmpty) content = stripEmptyLines(content);
    if (options.lineNumbers) content = injectLineNumbers(content);

    output += `### ${file}\n\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
  }
}

fs.writeFileSync(outputFile, output);
console.log(`Success! Created \x1b[32m${outputFile}\x1b[0m in your current folder.`);