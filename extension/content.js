/* AI Local Project Bridge — content script
 * Injects a floating panel into chatgpt.com / chat.deepseek.com that lets
 * you browse local project files and insert selected contents into the AI
 * input box, ALWAYS preceded by the project structure tree so the AI can
 * see how files are organized.
 *
 * Two data sources:
 *   MODE_LOCAL  : <input type="file" webkitdirectory> folder picker —
 *                 click, choose a directory, read files directly in browser.
 *                 No local server needed.
 *   MODE_SERVER : legacy FastAPI backend on localhost:8787 (multi-project).
 */
(function () {
  "use strict";

  const API_BASE = "http://127.0.0.1:8787";
  const MODE_LOCAL = "local";
  const MODE_SERVER = "server";
  const MAX_KB = 512;

  // Binary extensions (same rules as the server backend)
  const BINARY_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif",
    ".heic", ".heif", ".raw", ".psd", ".ai", ".sketch",
    ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg",
    ".mpeg", ".3gp",
    ".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma", ".m4a", ".opus",
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".iso", ".dmg",
    ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".lib", ".class",
    ".jar", ".war", ".pyc", ".pyd", ".wasm",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt",
    ".ods", ".odp", ".epub", ".mobi",
    ".db", ".sqlite", ".sqlite3", ".mdb", ".accdb",
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    ".dat", ".pak", ".bundle", ".asset", ".node",
  ]);

  const SKIP_DIRS = new Set([
    ".git", ".svn", ".hg", "node_modules", "__pycache__", ".venv", "venv",
    "env", ".idea", ".vscode", ".next", ".nuxt", ".cache",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist", "build", "target",
    "out", ".gradle", ".mvn", ".terraform", "vendor",
  ]);

  // ---- state ----
  let mode = MODE_LOCAL;              // default to the serverless picker
  let projects = [];
  let currentProject = -1;
  let treeCache = null;
  let selectedFiles = new Set();
  let localFileMap = new Map();       // relPath -> File (local mode)
  let panelEl = null;
  let toggleBtn = null;
  let folderInput = null;

  // ---- entry ----
  init();

  function init() {
    waitForBody().then(setupUI);
  }

  function waitForBody() {
    return new Promise((resolve) => {
      if (document.body) return resolve();
      const obs = new MutationObserver(() => {
        if (document.body) {
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(document.documentElement, { childList: true });
    });
  }

  // ------------------------------------------------------------------
  // UI scaffolding
  // ------------------------------------------------------------------
  function setupUI() {
    const root = document.createElement("div");
    root.id = "clb-root";
    root.innerHTML = `
      <button id="clb-toggle" title="ChatGPT Local Bridge">{"</button>
      <div id="clb-panel">
        <div class="clb-local-row">
          <button class="clb-btn clb-big" id="clb-pick-folder">📂 选择工作目录</button>
          <span class="clb-local-info" id="clb-local-info">无需本地服务器</span>
        </div>
        <div class="clb-header">
          <select id="clb-project-select" title="需要启动 start.ps1 的服务器模式"><option value="-1">[服务器模式] 选择项目…</option></select>
          <button class="clb-btn" id="clb-refresh" title="刷新文件树">↻</button>
        </div>
        <div class="clb-actions">
          <button class="clb-btn primary" id="clb-insert" title="插入时会自动在开头附带项目结构树">插入选中文件</button>
          <button class="clb-btn" id="clb-insert-structure" title="只插入目录树，让 AI 看懂项目结构">插入项目结构</button>
          <button class="clb-btn" id="clb-insert-all-text" title="插入时会自动在开头附带项目结构树">插入全部文本</button>
          <button class="clb-btn" id="clb-copy-bundle">复制 Markdown</button>
          <span style="flex:1"></span>
          <button class="clb-btn" id="clb-uncheck-all">全不选</button>
        </div>
        <div id="clb-tree">
          <div style="padding:12px;color:#888">👆 点「选择工作目录」挑一个文件夹</div>
        </div>
        <div class="clb-status" id="clb-status">就绪</div>
      </div>
    `;
    document.body.appendChild(root);

    panelEl = root.querySelector("#clb-panel");
    toggleBtn = root.querySelector("#clb-toggle");

    toggleBtn.addEventListener("click", () => {
      panelEl.classList.toggle("open");
    });

    // Folder picker button
    root.querySelector("#clb-pick-folder").addEventListener("click", pickLocalDirectory);

    root.querySelector("#clb-project-select").addEventListener("change", (e) => {
      currentProject = parseInt(e.target.value, 10);
      if (currentProject < 0) {
        mode = MODE_LOCAL;
        return;
      }
      mode = MODE_SERVER;
      treeCache = null;
      selectedFiles.clear();
      localFileMap.clear();
      loadTree();
    });

    root.querySelector("#clb-refresh").addEventListener("click", () => {
      if (mode === MODE_SERVER && currentProject >= 0) loadTree();
    });

    root.querySelector("#clb-insert").addEventListener("click", () => {
      const files = [...selectedFiles];
      if (files.length === 0) {
        setStatus("未勾选任何文件", true);
        return;
      }
      insertBundle(files);
    });

    root.querySelector("#clb-insert-all-text").addEventListener("click", () => {
      if (!treeCache) return;
      const allText = collectAllTextFiles(treeCache);
      if (allText.length === 0) {
        setStatus("没有可插入的文本文件", true);
        return;
      }
      insertBundle(allText);
    });

    root.querySelector("#clb-insert-structure").addEventListener("click", () => {
      if (!treeCache) {
        setStatus("请先选择工作目录", true);
        return;
      }
      insertStructureOnly();
    });

    root.querySelector("#clb-copy-bundle").addEventListener("click", () => {
      const files = [...selectedFiles];
      if (files.length === 0) {
        setStatus("未勾选任何文件", true);
        return;
      }
      copyBundle(files);
    });

    root.querySelector("#clb-uncheck-all").addEventListener("click", () => {
      selectedFiles.clear();
      renderTree();
      setStatus("已清空选择");
    });
  }

  // ------------------------------------------------------------------
  // LOCAL MODE: folder picker (no server)
  // ------------------------------------------------------------------
  function pickLocalDirectory() {
    if (!folderInput) {
      folderInput = document.createElement("input");
      folderInput.type = "file";
      folderInput.webkitdirectory = true;
      folderInput.style.display = "none";
      folderInput.addEventListener("change", onFolderPicked);
      document.body.appendChild(folderInput);
    }
    folderInput.value = "";
    folderInput.click();
  }

  async function onFolderPicked(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    mode = MODE_LOCAL;
    currentProject = -1;
    const sel = document.querySelector("#clb-project-select");
    sel.value = "-1";

    setStatus('<span class="clb-spinner"></span>整理文件树…');
    // Yield to let the status render
    await new Promise((r) => setTimeout(r, 30));

    // Build relPath map: webkitRelativePath like "myProject/src/main.py"
    localFileMap.clear();
    for (const f of files) {
      const rel = f.webkitRelativePath || f.name;
      // Strip first path segment (the picked folder name itself)
      const parts = rel.split("/");
      const relPath = parts.slice(1).join("/") || parts[0];
      // Skip unwanted dirs
      if (parts.some((p) => SKIP_DIRS.has(p))) continue;
      localFileMap.set(relPath, f);
    }

    treeCache = buildLocalTree([...localFileMap.keys()]);
    selectedFiles.clear();
    collectDefaultChecked(treeCache);
    renderTree();

    const dirName = (files[0].webkitRelativePath || "").split("/")[0] || "已选择目录";
    document.querySelector("#clb-local-info").textContent = `📁 ${dirName}（${files.length} 个文件）`;
    setStatus(`已选择目录，默认勾选 ${selectedFiles.size} 个文本文件`);
  }

  function buildLocalTree(paths) {
    const root = { name: "local", path: "", type: "dir", children: [] };
    const byPath = new Map([["", root]]);

    for (const rel of paths.sort()) {
      const parts = rel.split("/");
      let current = root;
      let acc = "";
      for (let i = 0; i < parts.length; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        let node = byPath.get(acc);
        if (!node) {
          const isFile = i === parts.length - 1;
          if (isFile) {
            const f = localFileMap.get(acc);
            const ext = parts[i].includes(".") ? "." + parts[i].split(".").pop().toLowerCase() : "";
            const sizeKb = f ? Math.max(0.1, f.size / 1024) : 0.1;
            const isBinary = BINARY_EXTENSIONS.has(ext);
            const tooBig = sizeKb > MAX_KB;
            node = {
              name: parts[i],
              path: acc,
              type: "file",
              ext,
              size_kb: Math.round(sizeKb * 10) / 10,
              is_text: !isBinary,       // text files can be manually picked even if big
              checked: !isBinary && !tooBig, // default-check only small text files
            };
          } else {
            node = { name: parts[i], path: acc, type: "dir", children: [] };
          }
          byPath.set(acc, node);
          current.children.push(node);
        }
        current = node;
      }
    }
    return root;
  }

  // ------------------------------------------------------------------
  // SERVER MODE API
  // ------------------------------------------------------------------
  async function api(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  }

  async function loadProjects() {
    try {
      setStatus('<span class="clb-spinner"></span>加载项目列表…');
      const data = await api("/api/projects");
      projects = data.projects || [];
      const sel = document.querySelector("#clb-project-select");
      sel.innerHTML = '<option value="-1">[服务器模式] 选择项目…</option>';
      projects.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = p.exists ? p.name : `${p.name} (路径不存在)`;
        if (!p.exists) opt.disabled = true;
        sel.appendChild(opt);
      });
      setStatus(`服务器模式：${projects.length} 个项目`);
    } catch (e) {
      setStatus(`连接失败: ${e.message}。请确认本地服务器已启动 (端口 8787)。`, true);
    }
  }

  async function loadTree() {
    try {
      setStatus('<span class="clb-spinner"></span>加载文件树…');
      const data = await api(`/api/tree?project_index=${currentProject}`);
      treeCache = data.tree;
      selectedFiles.clear();
      collectDefaultChecked(treeCache);
      renderTree();
      setStatus("文件树加载完成");
    } catch (e) {
      setStatus(`加载失败: ${e.message}`, true);
    }
  }

  function collectDefaultChecked(node) {
    if (node.type === "file" && node.checked) {
      selectedFiles.add(node.path);
    }
    if (node.children) {
      node.children.forEach(collectDefaultChecked);
    }
  }

  function collectAllTextFiles(node, out = []) {
    if (node.type === "file" && node.is_text) {
      out.push(node.path);
    }
    if (node.children) {
      node.children.forEach((c) => collectAllTextFiles(c, out));
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Tree rendering
  // ------------------------------------------------------------------
  function renderTree() {
    const container = document.querySelector("#clb-tree");
    container.innerHTML = "";
    if (!treeCache) {
      container.innerHTML = '<div style="padding:12px;color:#888">未加载</div>';
      return;
    }
    if (treeCache.children) {
      treeCache.children.forEach((child) => container.appendChild(renderNode(child, 0)));
    }
  }

  function renderNode(node, depth) {
    const wrapper = document.createElement("div");

    if (node.type === "dir") {
      const item = document.createElement("div");
      item.className = "clb-tree-item";
      item.innerHTML = `
        <span class="clb-chev">▶</span>
        <span class="clb-name">📁 ${escapeHtml(node.name)}</span>
      `;
      wrapper.appendChild(item);

      const childrenWrap = document.createElement("div");
      childrenWrap.className = "clb-tree-children";
      if (node.children) {
        node.children.forEach((c) => childrenWrap.appendChild(renderNode(c, depth + 1)));
      }
      wrapper.appendChild(childrenWrap);

      const chev = item.querySelector(".clb-chev");
      chev.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = childrenWrap.classList.toggle("open");
        chev.textContent = open ? "▼" : "▶";
      });
      item.querySelector(".clb-name").addEventListener("click", () => {
        const open = childrenWrap.classList.toggle("open");
        chev.textContent = open ? "▼" : "▶";
      });
    } else {
      const item = document.createElement("div");
      item.className = "clb-tree-item";
      const checked = selectedFiles.has(node.path);
      const dim = !node.is_text ? ' style="opacity:0.5"' : "";
      item.innerHTML = `
        <span class="clb-chev"></span>
        <input type="checkbox" data-path="${escapeAttr(node.path)}" ${checked ? "checked" : ""} ${dim}/>
        <span class="clb-name">${iconFor(node.ext)} ${escapeHtml(node.name)}</span>
        <span class="clb-size">${node.size_kb}KB</span>
      `;
      const cb = item.querySelector("input[type=checkbox]");
      cb.addEventListener("change", () => {
        if (cb.checked) selectedFiles.add(node.path);
        else selectedFiles.delete(node.path);
        setStatus(`已选 ${selectedFiles.size} 个文件`);
      });
      wrapper.appendChild(item);
    }
    return wrapper;
  }

  function iconFor(ext) {
    const map = {
      ".py": "🐍", ".js": "📜", ".ts": "📜", ".jsx": "📜", ".tsx": "📜",
      ".html": "🌐", ".css": "🎨", ".json": "📋", ".md": "📝", ".txt": "📄",
      ".go": "🐹", ".rs": "🦀", ".java": "☕", ".c": "🔧", ".cpp": "🔧",
      ".h": "🔧", ".sh": "⚙️", ".yml": "⚙️", ".yaml": "⚙️", ".toml": "⚙️",
      ".xml": "📋", ".sql": "🗄️",
    };
    return map[(ext || "").toLowerCase()] || "📄";
  }

  // ------------------------------------------------------------------
  // Bundle generation (local read or server api)
  // ------------------------------------------------------------------
  /**
   * Build an ASCII directory tree from treeCache so the AI can see the
   * project layout. Returns a string like:
   *   my-project/
   *   ├── src/
   *   │   ├── main.py
   *   │   └── utils.py
   *   └── README.md
   */
  function buildStructureTree() {
    if (!treeCache) return "";
    const lines = [];
    const rootName = treeCache.name || "project";
    lines.push(`${rootName}/`);

    const walk = (node, prefix, isLast) => {
      // Drop empty dirs so the tree stays compact
      const children = (node.children || []).filter((c) => !(c.type === "dir" && c.children.length === 0));
      const mark = isLast ? "└── " : "├── ";
      const suffix = node.type === "dir" ? "/" : "";
      lines.push(`${prefix}${mark}${node.name}${suffix}`);
      children.forEach((c, i) => {
        walk(c, prefix + (isLast ? "    " : "│   "), i === children.length - 1);
      });
    };

    const rootChildren = (treeCache.children || []).filter((c) => !(c.type === "dir" && c.children.length === 0));
    rootChildren.forEach((c, i) => {
      walk(c, "", i === rootChildren.length - 1);
    });
    return lines.join("\n");
  }

  function structurePrompt() {
    const tree = buildStructureTree();
    if (!tree) return "";
    return [
      "# 项目结构",
      "```",
      tree,
      "```",
      "",
    ].join("\n");
  }

  async function getBundleText(files) {
    if (mode === MODE_LOCAL) {
      // Read files via FileReader in browser — no server
      const parts = [structurePrompt(), "# Project Files Bundle\n", `Files: ${files.length}\n\n---\n`];
      const chunks = [];
      const CHUNK = 8;
      for (let i = 0; i < files.length; i += CHUNK) {
        const batch = files.slice(i, i + CHUNK);
        const results = await Promise.all(batch.map(readLocalFile));
        results.forEach(({ path, content, error }) => {
          chunks.push(`\n## \`${path}\`\n`);
          const lang = path.includes(".") ? path.split(".").pop() : "text";
          chunks.push(error ? `\n[Error: ${error}]\n` : `\`\`\`${lang}\n${content}\n\`\`\`\n`);
        });
      }
      return parts.join("") + chunks.join("");
    }
    // Server mode
    const data = await api("/api/bundle", {
      method: "POST",
      body: JSON.stringify({ project_index: currentProject, files }),
    });
    // Prepend the structure tree to the server bundle too
    const tree = structurePrompt();
    return tree ? tree + data.bundle : data.bundle;
  }

  /** Insert only the directory tree, so the AI can see how files are organized. */
  async function insertStructureOnly() {
    const text = structurePrompt();
    if (!text) {
      setStatus("没有可用的项目结构", true);
      return;
    }
    setStatus("正在插入项目结构…");
    const ok = await insertIntoChatInput(text);
    if (ok) {
      setStatus(`✅ 已插入项目结构 (${text.length} 字符)`);
    } else {
      await navigator.clipboard.writeText(text);
      setStatus("⚠️ 无法自动插入，已复制到剪贴板");
    }
  }

  function readLocalFile(rel) {
    return new Promise((resolve) => {
      const f = localFileMap.get(rel);
      if (!f) return resolve({ path: rel, error: "file not found" });
      const reader = new FileReader();
      reader.onload = () => resolve({ path: rel, content: String(reader.result) });
      reader.onerror = () => resolve({ path: rel, error: "read failed" });
      reader.readAsText(f, "utf-8");
    });
  }

  async function insertBundle(files) {
    try {
      setStatus('<span class="clb-spinner"></span>读取文件内容…');
      const text = await getBundleText(files);
      setStatus(`已生成 ${files.length} 个文件的合并文本，正在插入…`);

      const ok = await insertIntoChatInput(text);
      if (ok) {
        setStatus(`✅ 已插入 ${files.length} 个文件 (${text.length} 字符)`);
      } else {
        await navigator.clipboard.writeText(text);
        setStatus(`⚠️ 无法自动插入，已复制到剪贴板 (${text.length} 字符)`);
      }
    } catch (e) {
      setStatus(`插入失败: ${e.message}`, true);
    }
  }

  async function copyBundle(files) {
    try {
      setStatus('<span class="clb-spinner"></span>读取文件内容…');
      const text = await getBundleText(files);
      await navigator.clipboard.writeText(text);
      setStatus(`✅ 已复制 ${files.length} 个文件 (${text.length} 字符) 到剪贴板`);
    } catch (e) {
      setStatus(`复制失败: ${e.message}`, true);
    }
  }

  /**
   * Try to insert text into ChatGPT / DeepSeek input box.
   * - ChatGPT: ProseMirror contenteditable
   * - DeepSeek: <textarea id="chat-input">
   */
  async function insertIntoChatInput(text) {
    // DeepSeek: textarea #chat-input
    const ds = document.querySelector('textarea#chat-input');
    if (ds) {
      ds.focus();
      const ok = document.execCommand("insertText", false, text);
      if (ok && ds.value.length > 0) return true;
      ds.value = text;
      ds.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    const editors = document.querySelectorAll('div[contenteditable="true"]');
    for (const ed of editors) {
      const closest = ed.closest("form");
      if (closest || ed.getAttribute("id") === "prompt-textarea") {
        if (tryInsertProseMirror(ed, text)) return true;
      }
    }
    for (const ed of document.querySelectorAll('div[contenteditable="true"]')) {
      if (tryInsertProseMirror(ed, text)) return true;
    }
    const ta = document.querySelector('textarea[data-id="root"]') || document.querySelector("textarea#prompt-textarea");
    if (ta) {
      ta.focus();
      const ok = document.execCommand("insertText", false, text);
      if (ok) return true;
      ta.value = text;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  function tryInsertProseMirror(el, text) {
    el.focus();
    const ok = document.execCommand("insertText", false, text);
    if (ok && el.textContent.length > 0) return true;
    try {
      const lines = text.split("\n");
      const frag = document.createDocumentFragment();
      lines.forEach((line) => {
        const p = document.createElement("p");
        p.textContent = line;
        frag.appendChild(p);
      });
      el.appendChild(frag);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function setStatus(msg, isError = false) {
    const el = document.querySelector("#clb-status");
    if (!el) return;
    el.innerHTML = msg;
    el.classList.toggle("error", !!isError);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
})();
