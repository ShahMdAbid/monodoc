/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Loader2, Copy, Check, Download, Sun, Moon, FolderOpen, Settings, X, ChevronRight, ChevronDown, Minus } from 'lucide-react';
import { useTheme } from 'next-themes';
import ignore from 'ignore';
import { getEncoding } from 'js-tiktoken';

// Initialize tiktoken encoder outside the component
const encoder = getEncoding("cl100k_base");

interface RepoFile {
  path: string;
  content: string;
  size: number;
}

const stripEmptyLines = (text: string): string => {
  if (!text) return '';
  return text.replace(/^\s*[\r\n]/gm, '');
};

const stripComments = (text: string, ext: string): string => {
  if (!text) return text;
  const lowerExt = ext.toLowerCase();

  // 1. C-Style (JS, TS, Java, C, C++, C#, Go, Rust, Swift, PHP)
  if (['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.swift', '.php'].includes(lowerExt)) {
    // Removes /* ... */ and // ... but smartly IGNORES http:// and https://
    return text.replace(/\/\*[\s\S]*?\*\/|(?<!https?:|http:)\/\/.*/g, '');
  }

  // 2. Hash-Style (Python, Ruby, Shell, YAML, Dockerfile, Perl)
  if (['.py', '.rb', '.sh', '.yaml', '.yml', '.dockerfile', '.pl'].includes(lowerExt)) {
    // Removes # comments
    return text.replace(/(?<!['"]\s*)#.*/g, ''); 
  }

  // 3. HTML / XML / Markdown / Vue / Svelte
  if (['.html', '.xml', '.md', '.vue', '.svelte'].includes(lowerExt)) {
    // Removes <!-- ... -->
    return text.replace(/<!--[\s\S]*?-->/g, '');
  }

  // 4. CSS
  if (['.css'].includes(lowerExt)) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '');
  }

  return text; // Default: return unmodified if unknown language
};

const injectLineNumbers = (text: string): string => {
  if (!text) return text;
  const lines = text.split('\n');
  const maxDigits = String(lines.length).length;
  return lines.map((line, index) => {
    const lineNumber = String(index + 1).padStart(maxDigits, ' ');
    return `${lineNumber} | ${line}`;
  }).join('\n');
};

const DEFAULT_IGNORE_CATEGORIES = [
  {
    category: "Dependency Directories",
    rules: [
      { id: "node_modules", patterns: ["node_modules/"], label: "Node.js", enabled: true },
      { id: "python_env", patterns: ["venv/", ".venv/", "env/", "__pycache__/"], label: "Python", enabled: true },
      { id: "rust_target", patterns: ["target/"], label: "Rust", enabled: true },
      { id: "java_build", patterns: [".gradle/", "build/"], label: "Java", enabled: true }
    ]
  },
  {
    category: "Environment Variables & Secrets",
    rules: [
      { id: "env_files", patterns: [".env", ".env.*"], label: "Environment Files", enabled: true },
      { id: "secrets", patterns: ["*.pem", "credentials.json"], label: "Keys & Credentials", enabled: true }
    ]
  },
  {
    category: "Build & Compiled Output",
    rules: [
      { id: "web_build", patterns: ["dist/", "build/", ".next/", ".out/"], label: "Web Builds", enabled: true },
      { id: "compiled", patterns: ["*.o", "*.exe", "*.out", "*.class", "*.jar"], label: "Compiled Binaries", enabled: true },
      { id: "logs", patterns: ["*.log", "npm-debug.log*"], label: "Log Files", enabled: true }
    ]
  },
  {
    category: "OS & IDE Specific Files",
    rules: [
      { id: "mac_windows", patterns: [".DS_Store", "Thumbs.db", "desktop.ini"], label: "OS System Files", enabled: true },
      { id: "ides", patterns: [".vscode/", ".idea/", "*~", "*.swp"], label: "IDE Configurations", enabled: true }
    ]
  },
  {
    category: "Local Database & Storage",
    rules: [
      { id: "databases", patterns: ["*.sqlite", "*.db"], label: "Local Databases", enabled: true },
      { id: "uploads", patterns: ["public/uploads/", "storage/"], label: "Uploads & Storage", enabled: true }
    ]
  },
  {
    category: "Version Control & CI/CD",
    rules: [
      { id: "git_internal", patterns: [".git/"], label: "Git Internals", enabled: true },
      { id: "github_actions", patterns: [".github/"], label: "GitHub Actions", enabled: true }
    ]
  },
  {
    category: "Tools & Assets",
    rules: [
      { id: "coverage", patterns: ["coverage/"], label: "Coverage Reports", enabled: true },
      { id: "docs_temp", patterns: ["docs/_build/", "tmp/", "temp/"], label: "Temp & Doc Builds", enabled: true }
    ]
  },
  {
    category: "Web Assets & Media",
    rules: [
      { id: "public_assets", patterns: ["public/assets/", "public/images/", "public/media/"], label: "Public Asset Directories", enabled: false },
      { id: "static_media", patterns: ["static/", "images/", "media/"], label: "Static Media Directories", enabled: false }
    ]
  }
];

const generateDirectoryTree = (paths: string[]): string => {
  if (!paths || paths.length === 0) return '';
  
  const tree: { [key: string]: any } = {};
  for (const path of paths) {
    const parts = path.split('/');
    let current = tree;
    for (const part of parts) {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
  }

  let result = '';
  
  const buildTreeString = (node: any, prefix: string = '') => {
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
};

// --- START OF TREE VIEW LOGIC ---
interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: Record<string, FileNode>;
  size: number;
}

const buildFileTree = (files: RepoFile[]): FileNode => {
  const root: FileNode = { name: 'root', path: '', isDirectory: true, children: {}, size: 0 };
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');
      if (!current.children[part]) {
        current.children[part] = { name: part, path: currentPath, isDirectory: !isLast, children: {}, size: 0 };
      }
      if (isLast) current.children[part].size = file.size;
      current = current.children[part];
    }
  }
  return root;
};

const FileTreeNode: React.FC<{
  node: FileNode;
  selectedFilePaths: string[];
  toggleFileSelection: (path: string) => void;
  handleToggleFolder: (paths: string[], forceCheck: boolean) => void;
}> = ({
  node,
  selectedFilePaths,
  toggleFileSelection,
  handleToggleFolder
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  // Recursively get all files inside this folder
  const getDescendantFiles = (n: FileNode): string[] => {
    if (!n.isDirectory) return [n.path];
    return Object.values(n.children).flatMap(getDescendantFiles);
  };

  const descendantFiles = getDescendantFiles(node);
  const selectedCount = descendantFiles.filter(f => selectedFilePaths.includes(f)).length;
  const totalCount = descendantFiles.length;

  const isChecked = selectedCount === totalCount && totalCount > 0;
  const isIndeterminate = selectedCount > 0 && selectedCount < totalCount;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      handleToggleFolder(descendantFiles, !isChecked);
    } else {
      toggleFileSelection(node.path);
    }
  };

  const sortedChildren = (Object.values(node.children) as FileNode[]).sort((a, b) => {
    if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
    return a.isDirectory ? -1 : 1; // Folders first
  });

  return (
    <div className="flex flex-col select-none">
      <div 
        className="flex items-center justify-between py-1.5 px-2 hover:bg-gray-100 dark:hover:bg-neutral-800/60 rounded-lg transition-colors cursor-pointer group"
        onClick={handleToggle}
      >
        <div className="flex items-center overflow-hidden">
          {/* Chevron for Folders */}
          <div 
            className={`w-5 h-5 flex items-center justify-center shrink-0 ${!node.isDirectory && 'opacity-0'}`}
            onClick={(e) => {
              e.stopPropagation(); // Prevents checkbox toggle when clicking chevron
              if (node.isDirectory) setIsExpanded(!isExpanded);
            }}
          >
            {node.isDirectory && (
              isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500 hover:text-gray-900 dark:hover:text-white" /> 
                         : <ChevronRight className="w-4 h-4 text-gray-500 hover:text-gray-900 dark:hover:text-white" />
            )}
          </div>

          {/* Indeterminate Checkbox */}
          <div className="relative flex items-center justify-center mx-2 shrink-0">
            <input
              type="checkbox"
              checked={isChecked}
              readOnly
              title={`Toggle ${node.name}`}
              className={`appearance-none w-4 h-4 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer ${
                isChecked || isIndeterminate
                  ? 'bg-indigo-600 border-indigo-600 dark:border-indigo-600'
                  : 'bg-gray-50 dark:bg-neutral-800 border-gray-300 dark:border-neutral-600'
              }`}
            />
            {isChecked && !isIndeterminate && <Check className="absolute w-3 h-3 text-white pointer-events-none" strokeWidth={3} />}
            {isIndeterminate && <Minus className="absolute w-3 h-3 text-white pointer-events-none" strokeWidth={3} />}
          </div>

          <span className={`flex items-center truncate font-mono text-xs transition-colors ${
            !isChecked && !isIndeterminate ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-800 dark:text-gray-200 group-hover:text-black dark:group-hover:text-white'
          }`}>
            {node.name}
          </span>
        </div>

        {/* Show File Size on the Right */}
        {!node.isDirectory && (
          <span className="text-gray-400 dark:text-neutral-500 whitespace-nowrap text-[11px] ml-4 shrink-0">
            {node.size.toLocaleString()} chars
          </span>
        )}
      </div>

      {/* Recursive Children Rendering */}
      {node.isDirectory && isExpanded && (
        <div className="ml-5 border-l border-gray-200/50 dark:border-gray-800/50 pl-1 mt-0.5 flex flex-col gap-0.5">
          {sortedChildren.map(child => (
            <FileTreeNode key={child.path} node={child} selectedFilePaths={selectedFilePaths} toggleFileSelection={toggleFileSelection} handleToggleFolder={handleToggleFolder} />
          ))}
        </div>
      )}
    </div>
  );
};
// --- END OF TREE VIEW LOGIC ---

export default function App() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const resultsRef = useRef<HTMLDivElement>(null); // Added for auto-scroll
  const [mounted, setMounted] = useState(false);
  const [displayedText, setDisplayedText] = useState('');
  const texts = [
    'Eliminate context fragmentation by consolidating source files into single document.',
    'Pack. Copy. Prompt.'

  ];

  useEffect(() => {
    setMounted(true);
    let isMounted = true; 

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const runTypewriter = async () => {
      let textIndex = 0;

      while (isMounted) {
        const currentText = texts[textIndex];

        for (let i = 0; i <= currentText.length; i++) {
          if (!isMounted) return;
          setDisplayedText(currentText.slice(0, i));
          await sleep(40); 
        }

        await sleep(5000);

        if (!isMounted) return;

        setDisplayedText('');
        await sleep(200); 

        textIndex = (textIndex + 1) % texts.length;
      }
    };

    const timeoutId = setTimeout(() => {
      runTypewriter();
    }, 500);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, []);

  const [repoUrl, setRepoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetchedFiles, setFetchedFiles] = useState<RepoFile[]>([]);
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repoName: string; branch: string; totalFilesCount?: number; allPaths?: string[] } | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [ignoreCategories, setIgnoreCategories] = useState(DEFAULT_IGNORE_CATEGORIES);

  // Helper to extract a flat list of patterns from checked rules
  const getActiveIgnorePatterns = () => {
    return ignoreCategories
      .flatMap(cat => cat.rules)
      .filter(rule => rule.enabled)
      .flatMap(rule => rule.patterns);
  };

  const toggleIgnoreRule = (categoryId: string, ruleId: string) => {
    setIgnoreCategories(prev => prev.map(cat => {
      if (cat.category !== categoryId) return cat;
      return {
        ...cat,
        rules: cat.rules.map(rule => rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)
      };
    }));
  };
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [finalMarkdown, setFinalMarkdown] = useState('');

  const [includeDirectoryStructure, setIncludeDirectoryStructure] = useState(true);
  const [removeEmptyLines, setRemoveEmptyLines] = useState(true);
  const [removeComments, setRemoveComments] = useState(true);
  const [addLineNumbers, setAddLineNumbers] = useState(false);
  const [outputFormat, setOutputFormat] = useState<'markdown' | 'xml'>('markdown'); // Added output format state

  const stats = useMemo(() => {
    let totalSize = 0;
    let totalTokens = 0;
    const selectedFiles = fetchedFiles.filter(f => selectedFilePaths.includes(f.path));
    for (const file of selectedFiles) {
      totalSize += file.content.length;
      totalTokens += encoder.encode(file.content).length; // Accurate token count
    }
    return {
      totalFiles: selectedFiles.length,
      totalTokens,
      totalSize
    };
  }, [fetchedFiles, selectedFilePaths]);

  const generateOutput = (selectedFilesArray: RepoFile[]) => {
    let output = '';
    const notesBlock = `<notes>\n- Some files may have been excluded based on .gitignore rules and monodoc's configuration\n- Binary files are not included in this packed representation. Please refer to the directory structure for a complete list of file paths, including binary files\n</notes>\n\n`;
    
    // Fallback to selected files if allPaths isn't available
    const treePaths = repoInfo?.allPaths && repoInfo.allPaths.length > 0 
      ? repoInfo.allPaths 
      : selectedFilesArray.map(f => f.path);

    if (outputFormat === 'markdown') {
      output += notesBlock;
      if (includeDirectoryStructure) {
        output += `## Directory Structure\n\n\`\`\`text\n`;
        output += generateDirectoryTree(treePaths);
        output += `\`\`\`\n\n`;
      }
      const extensionToLanguage: Record<string, string> = {
        '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
        '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.cpp': 'cpp', '.hpp': 'cpp',
        '.c': 'c', '.h': 'c', '.html': 'html', '.css': 'css', '.json': 'json', '.md': 'markdown',
        '.sh': 'bash', '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml', '.sql': 'sql', '.rb': 'ruby',
        '.php': 'php', '.swift': 'swift', '.kt': 'kotlin'
      };
      for (const file of selectedFilesArray) {
        const extMatch = file.path.match(/\.[^.]+$/);
        const ext = extMatch ? extMatch[0].toLowerCase() : '';
        const lang = extensionToLanguage[ext] || '';
        let finalContent = file.content;
        if (removeComments) finalContent = stripComments(finalContent, ext);
        if (removeEmptyLines) finalContent = stripEmptyLines(finalContent);
        if (addLineNumbers) finalContent = injectLineNumbers(finalContent);
        output += `### ${file.path}\n\n\`\`\`${lang}\n${finalContent}\n\`\`\`\n\n`;
      }
    } else if (outputFormat === 'xml') {
      output += `<?xml version="1.0" encoding="UTF-8"?>\n<repository>\n`;
      output += notesBlock;
      if (includeDirectoryStructure) {
        output += `  <directory_structure>\n<![CDATA[\n${generateDirectoryTree(treePaths)}\n]]>\n  </directory_structure>\n`;
      }
      output += `  <files>\n`;
      for (const file of selectedFilesArray) {
        const extMatch = file.path.match(/\.[^.]+$/);
        const ext = extMatch ? extMatch[0].toLowerCase() : '';
        let finalContent = file.content;
        if (removeComments) finalContent = stripComments(finalContent, ext);
        if (removeEmptyLines) finalContent = stripEmptyLines(finalContent);
        if (addLineNumbers) finalContent = injectLineNumbers(finalContent);
        
        // Escape existing CDATA closing tags in the source code to prevent XML breakage
        const safeContent = finalContent.replace(/]]>/g, ']]]]><![CDATA[>');
        output += `    <file path="${file.path}">\n<![CDATA[\n${safeContent}\n]]>\n    </file>\n`;
      }
      output += `  </files>\n</repository>\n`;
    }

    setFinalMarkdown(output);
  };

  React.useEffect(() => {
    const selectedFiles = fetchedFiles.filter(f => selectedFilePaths.includes(f.path));
    if (selectedFiles.length > 0) {
      generateOutput(selectedFiles);
    } else {
      setFinalMarkdown('');
    }
  }, [fetchedFiles, selectedFilePaths, includeDirectoryStructure, removeEmptyLines, removeComments, outputFormat, addLineNumbers, repoInfo]);

  const handleCopy = async () => {
    if (!finalMarkdown) return;
    try {
      await navigator.clipboard.writeText(finalMarkdown);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleDownload = () => {
    if (!finalMarkdown) return;
    const mimeType = outputFormat === 'xml' ? 'application/xml' : 'text/markdown';
    const ext = outputFormat === 'xml' ? '.xml' : '.md';
    const blob = new Blob([finalMarkdown], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = repoInfo?.repoName ? `${repoInfo.repoName}${ext}` : `repository${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!repoUrl) {
      setError('Please enter a valid URL.');
      return;
    }

    setIsLoading(true);
    setFetchedFiles([]);
    setRepoInfo(null);
    setSelectedFilePaths([]);
    setShowMarkdown(false);
    
    try {
      const activeIgnorePatterns = getActiveIgnorePatterns();
      const response = await fetch('/api/pack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          url: repoUrl,
          customIgnorePatterns: activeIgnorePatterns
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Check the URL and try again.');
      }

      setFetchedFiles(data.data.files);
      setSelectedFilePaths(data.data.files.map((f: RepoFile) => f.path));
      setRepoInfo({
        owner: data.data.owner,
        repoName: data.data.repoName,
        branch: data.data.branch,
        totalFilesCount: data.data.totalFilesCount,
        allPaths: data.data.allPaths
      });
      
      // Auto-scroll to results after DOM updates
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectAll = () => setSelectedFilePaths(fetchedFiles.map(f => f.path));
  const handleDeselectAll = () => setSelectedFilePaths([]);
  const toggleFileSelection = (path: string) => {
    setSelectedFilePaths(prev => 
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  };

  const handleToggleFolder = (pathsToToggle: string[], forceCheck: boolean) => {
    if (forceCheck) {
      // Add all folder files to selection
      setSelectedFilePaths(prev => Array.from(new Set([...prev, ...pathsToToggle])));
    } else {
      // Remove all folder files from selection
      const toRemove = new Set(pathsToToggle);
      setSelectedFilePaths(prev => prev.filter(p => !toRemove.has(p)));
    }
  };

  // Convert flat files into our Tree structure (Auto-updates when files change)
  const fileTree = useMemo(() => buildFileTree(fetchedFiles), [fetchedFiles]);
  const sortedRootChildren = (Object.values(fileTree.children) as FileNode[]).sort((a, b) => {
    if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
    return a.isDirectory ? -1 : 1;
  });

  const handleLocalFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // 1. Immediately set the loading state and clear old data
    setIsLoading(true);
    setError('');
    setFetchedFiles([]);
    setSelectedFilePaths([]);
    setShowMarkdown(false);

    // 2. CRITICAL FIX: Yield the main thread for 50ms so React can render the loading spinner!
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      // Fetch user's active ignore rules from the Settings UI
      const activeIgnorePatterns = getActiveIgnorePatterns();
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
      const fileArray = Array.from(files) as any[];

      // Find the root .gitignore
      const gitignoreFile = fileArray.find(f => {
        const parts = f.webkitRelativePath.split('/');
        return parts.length === 2 && parts[1] === '.gitignore';
      });

      if (gitignoreFile) {
        gitignoreContent = await gitignoreFile.text();
      }

      const ig = ignore();
      if (gitignoreContent) ig.add(gitignoreContent);
      if (activeIgnorePatterns.length > 0) ig.add(activeIgnorePatterns);

      const processedFiles: RepoFile[] = [];
      const allPaths: string[] = [];
      
      // 3. Set limit to exactly 30MB
      const MAX_TEXT_SIZE = 30 * 1024 * 1024; 
      let totalSize = 0;

      for (const file of fileArray) {
        const pathParts = file.webkitRelativePath.split('/');
        pathParts.shift(); 
        const cleanPath = pathParts.join('/'); 
        if (!cleanPath) continue;

        // Hard-block .git instantly for performance
        if (cleanPath.startsWith('.git/') || cleanPath.includes('/.git/')) continue;

        // Apply ignore rules (from Settings + .gitignore)
        let isIgnored = false;
        try {
            isIgnored = ig.ignores(cleanPath);
        } catch(e) {}
        if (isIgnored) continue;

        allPaths.push(cleanPath);

        const extMatch = cleanPath.match(/\.[^.]+$/);
        const ext = extMatch ? extMatch[0].toLowerCase() : '';
        if (BINARY_EXTENSIONS.includes(ext)) continue;

        // Read the file safely
        const content = await file.text();
        const size = content.length;
        
        totalSize += size;
        if (totalSize > MAX_TEXT_SIZE) {
          throw new Error("Total text size exceeds 30MB limit. Please exclude more files in Settings or .gitignore.");
        }

        processedFiles.push({ path: cleanPath, content, size });
      }

      setFetchedFiles(processedFiles);
      setSelectedFilePaths(processedFiles.map((f) => f.path));
      setRepoInfo({
        owner: 'Local',
        repoName: fileArray[0].webkitRelativePath.split('/')[0],
        branch: 'local-machine',
        totalFilesCount: allPaths.length,
        allPaths: allPaths
      });

      // Auto-scroll to results after DOM updates
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } catch (err: any) {
      setError(err.message || 'Error reading local files.');
    } finally {
      setIsLoading(false);
      // Reset the file input so the user can select the same folder again later if needed
      e.target.value = ''; 
    }
  };

  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-[#121212] text-gray-900 dark:text-neutral-100 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 font-sans transition-colors duration-200">
      {mounted && (
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-3 z-50">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full bg-white dark:bg-[#1E1E1E] text-gray-700 dark:text-gray-200 shadow-sm border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm font-medium hidden sm:inline">Ignore Config</span>
          </button>
          
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="p-2 sm:p-2.5 rounded-full bg-white dark:bg-[#1E1E1E] text-gray-800 dark:text-gray-200 shadow-sm border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
          >
            {isDark ? <Sun className="w-4 h-4 sm:w-5 sm:h-5" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
        </div>
      )}
      <div className="w-full max-w-5xl flex flex-col gap-8">
        {/* Header */}
        <div className="text-center pt-8 pb-4">
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-4">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500">
              MonoDoc
            </span>
          </h1>
          {/* Added specific height classes (h-24 sm:h-20 md:h-16) to prevent layout shift during the typewriter effect */}
          <p className="text-lg md:text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto h-24 sm:h-20 md:h-16">
            <span>{displayedText}</span>
            <span className="text-indigo-500 animate-pulse ml-1">|</span>
          </p>
        </div>

        <div className="w-full flex flex-col gap-6">
          {/* Main Action Area */}
          <div className="w-full flex flex-col md:flex-row gap-6 md:gap-4 items-stretch bg-white/50 dark:bg-[#1E1E1E]/50 p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-gray-800/60 shadow-sm">
            
            {/* GitHub URL Form */}
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 flex-1">
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                disabled={isLoading}
                className="flex-1 w-full text-base rounded-xl border border-gray-300 dark:border-neutral-700 bg-white dark:bg-[#121212] px-5 py-3.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 transition-all shadow-sm"
                required
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="submit"
                disabled={isLoading || !repoUrl}
                className="w-full sm:w-auto inline-flex justify-center items-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 px-8 py-3.5 text-base font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/30 active:translate-y-0 whitespace-nowrap"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                    Fetching...
                  </>
                ) : (
                  'Fetch Files'
                )}
              </button>
            </form>

            {/* Responsive "OR" Divider */}
            <div className="flex md:flex-col items-center justify-center shrink-0 opacity-70">
              <div className="h-px w-full md:w-px md:h-full bg-gray-300 dark:bg-neutral-700 flex-1"></div>
              <span className="px-4 py-2 text-xs font-bold text-gray-500 dark:text-neutral-400 uppercase tracking-widest">OR</span>
              <div className="h-px w-full md:w-px md:h-full bg-gray-300 dark:bg-neutral-700 flex-1"></div>
            </div>

            {/* Local Folder Upload */}
            <div className="relative w-full md:w-auto md:min-w-[200px] shrink-0">
              <input
                type="file"
                title="Upload Local Folder"
                /* @ts-ignore */
                webkitdirectory="true"
                directory="true"
                multiple
                onChange={handleLocalFolderSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                disabled={isLoading}
              />
              <button
                type="button"
                disabled={isLoading}
                className="w-full inline-flex justify-center items-center rounded-xl border border-gray-300 dark:border-neutral-700 bg-white dark:bg-[#121212] hover:bg-gray-50 dark:hover:bg-neutral-800 px-8 py-3.5 text-base font-semibold text-gray-700 dark:text-gray-200 shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:-translate-y-0.5 active:translate-y-0 whitespace-nowrap"
              >
                📁 Upload Folder
              </button>
            </div>
            
          </div>

          {/* Output Configuration Toggles */}
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row flex-wrap gap-4 sm:gap-8 justify-center items-center">
            {/* Format Selector */}
            <div className="flex items-center space-x-3 pr-4 sm:border-r border-gray-200 dark:border-gray-700">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Format:</span>
              <select
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value as 'markdown' | 'xml')}
                title="Select Output Format"
                className="text-sm bg-gray-50 dark:bg-neutral-900 border border-gray-300 dark:border-neutral-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700 dark:text-gray-300 cursor-pointer"
              >
                <option value="markdown">Markdown (.md)</option>
                <option value="xml">XML (.xml)</option>
              </select>
            </div>
            
            <label className="flex items-center space-x-3 cursor-pointer group">
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={includeDirectoryStructure}
                  onChange={(e) => setIncludeDirectoryStructure(e.target.checked)}
                  className="peer appearance-none w-5 h-5 border border-gray-300 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-900 rounded checked:bg-indigo-600 checked:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-[#1E1E1E] transition-all"
                />
                <Check className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" strokeWidth={3} />
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-black dark:group-hover:text-white transition-colors">Include Directory Structure</span>
            </label>
            
            <label className="flex items-center space-x-3 cursor-pointer group">
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={removeEmptyLines}
                  onChange={(e) => setRemoveEmptyLines(e.target.checked)}
                  className="peer appearance-none w-5 h-5 border border-gray-300 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-900 rounded checked:bg-indigo-600 checked:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-[#1E1E1E] transition-all"
                />
                <Check className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" strokeWidth={3} />
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-black dark:group-hover:text-white transition-colors">Remove Empty Lines</span>
            </label>
            
            <label className="flex items-center space-x-3 cursor-pointer group">
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={removeComments}
                  onChange={(e) => setRemoveComments(e.target.checked)}
                  className="peer appearance-none w-5 h-5 border border-gray-300 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-900 rounded checked:bg-indigo-600 checked:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-[#1E1E1E] transition-all"
                />
                <Check className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" strokeWidth={3} />
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-black dark:group-hover:text-white transition-colors">Remove Comments</span>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer group">
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={addLineNumbers}
                  onChange={(e) => setAddLineNumbers(e.target.checked)}
                  className="peer appearance-none w-5 h-5 border border-gray-300 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-900 rounded checked:bg-indigo-600 checked:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-[#1E1E1E] transition-all"
                />
                <Check className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" strokeWidth={3} />
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-black dark:group-hover:text-white transition-colors">Add Line Numbers</span>
            </label>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
            <h3 className="text-sm font-medium text-red-500 text-center">{error}</h3>
          </div>
        )}

        {/* Output Area or Dashboard */}
        <div ref={resultsRef} className="w-full scroll-mt-6 flex flex-col">
          {fetchedFiles.length > 0 && repoInfo ? (
          showMarkdown ? (
            <div className="flex-1 flex flex-col min-h-[500px] mt-2 mb-8">
              <div className="flex justify-between items-center mb-4">
                <button
                  onClick={() => setShowMarkdown(false)}
                  className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap flex items-center pr-2"
                >
                  &larr; <span className="hidden sm:inline ml-1">Back to Dashboard</span><span className="sm:hidden ml-1">Back</span>
                </button>
                <div className="flex gap-2 sm:gap-3">
                  <button
                    onClick={handleCopy}
                    className="inline-flex justify-center items-center rounded-xl border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800/80 hover:bg-gray-100 dark:hover:bg-neutral-700 text-gray-700 dark:text-white px-3 sm:px-6 py-3 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
                    title="Copy to Clipboard"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-4 h-4 sm:mr-2 text-green-500 dark:text-green-400" />
                        <span className="hidden sm:inline">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 sm:mr-2 text-gray-500 dark:text-neutral-400" />
                        <span className="hidden sm:inline">Copy to Clipboard</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="inline-flex justify-center items-center rounded-xl border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800/80 hover:bg-gray-100 dark:hover:bg-neutral-700 text-gray-700 dark:text-white px-3 sm:px-6 py-3 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
                    title={`Download .${outputFormat === 'xml' ? 'xml' : 'md'} file`}
                  >
                    <Download className="w-4 h-4 sm:mr-2 text-gray-500 dark:text-neutral-400" />
                    <span className="hidden sm:inline">Download .{outputFormat === 'xml' ? 'xml' : 'md'} file</span>
                    <span className="sm:hidden font-mono text-xs">.{outputFormat === 'xml' ? 'xml' : 'md'}</span>
                  </button>
                </div>
              </div>
              <label htmlFor="markdown-output" className="sr-only">
                Markdown Output
              </label>
              <div className="relative flex-1 group">
                <textarea
                  id="markdown-output"
                  value={finalMarkdown}
                  readOnly
                  placeholder={`${outputFormat === 'xml' ? 'XML' : 'Markdown'} output will appear here...`}
                  className="absolute inset-0 w-full h-full rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-[#1E1E1E] px-6 py-5 text-gray-800 dark:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm leading-relaxed resize-none transition-colors shadow-sm"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mb-8 items-start">
              {/* Left Column (Span 1) */}
              <div className="col-span-1 flex flex-col gap-6">
                {/* Summary Card */}
                <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm">
                  <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Info</h2>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Owner</span>
                      <span className="font-bold text-gray-900 dark:text-white">{repoInfo.owner}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Repo</span>
                      <span className="font-bold text-gray-900 dark:text-white">{repoInfo.repoName}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Branch</span>
                      <span className="font-bold text-gray-900 dark:text-white">{repoInfo.branch}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Files</span>
                      <span className="font-bold text-gray-900 dark:text-white">{repoInfo.totalFilesCount || fetchedFiles.length}</span>
                    </div>
                  </div>
                </div>
                
                {/* Pack Summary Card */}
                <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm">
                  <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Pack Summary</h2>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Selected Files</span>
                      <span className="font-bold text-gray-900 dark:text-white">{stats.totalFiles}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Tokens</span>
                      <span className="font-bold text-gray-900 dark:text-white">~{stats.totalTokens.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Size</span>
                      <span className="font-bold text-gray-900 dark:text-white">{stats.totalSize.toLocaleString()} chars</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column (Span 2) */}
              <div className="col-span-1 md:col-span-2 relative">
                <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm h-[600px] flex flex-col overflow-hidden">
                  <div className="sticky top-0 bg-white dark:bg-[#1E1E1E] border-b border-gray-200 dark:border-gray-800 p-4 shrink-0 flex flex-col sm:flex-row justify-between items-center gap-4 z-10">
                    <div className="flex gap-2">
                      <button
                        onClick={handleSelectAll}
                        className="text-xs font-medium border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-neutral-300 bg-transparent py-2 px-3 rounded-md transition-colors"
                      >
                        Select All
                      </button>
                      <button
                        onClick={handleDeselectAll}
                        className="text-xs font-medium border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-neutral-300 bg-transparent py-2 px-3 rounded-md transition-colors"
                      >
                        Deselect All
                      </button>
                    </div>
                    <button
                      onClick={() => setShowMarkdown(true)}
                      disabled={selectedFilePaths.length === 0}
                      className="whitespace-nowrap px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-[#1E1E1E] text-white text-sm font-semibold rounded-lg shadow disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/30 active:translate-y-0"
                    >
                      Pack Selected
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 custom-scrollbar flex flex-col gap-1">
                    {sortedRootChildren.map(child => (
                      <FileTreeNode
                        key={child.path}
                        node={child}
                        selectedFilePaths={selectedFilePaths}
                        toggleFileSelection={toggleFileSelection}
                        handleToggleFolder={handleToggleFolder}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        ) : null}
        </div> {/* <-- ADD THIS CLOSING DIV HERE */}
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity">
          <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Ignore Rules</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Select the files and folders you want to exclude from the pack.</p>
              </div>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                title="Close settings"
                aria-label="Close settings"
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {ignoreCategories.map((category, idx) => (
                <div key={idx} className="space-y-3">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200 border-b border-gray-100 dark:border-gray-800 pb-2">
                    {category.category}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {category.rules.map(rule => (
                      <label key={rule.id} className="flex items-start space-x-3 cursor-pointer group p-2 hover:bg-gray-50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors">
                        <div className="relative flex items-center justify-center mt-0.5">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={() => toggleIgnoreRule(category.category, rule.id)}
                            className="peer appearance-none w-4 h-4 border border-gray-300 dark:border-neutral-600 bg-gray-50 dark:bg-neutral-800 rounded checked:bg-indigo-600 checked:border-indigo-600 focus:outline-none transition-all"
                          />
                          <Check className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" strokeWidth={3} />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-black dark:group-hover:text-white transition-colors">{rule.label}</span>
                          <span className="text-xs text-gray-500 font-mono mt-0.5">{rule.patterns.join(', ')}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#121212] flex justify-end gap-3">
              <button 
                onClick={() => setIgnoreCategories(DEFAULT_IGNORE_CATEGORIES)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Reset Defaults
              </button>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
