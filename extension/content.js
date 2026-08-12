/* ChatGPT Local Project Bridge — content script
 * Injects a floating panel into chatgpt.com that lets you browse local
 * project files (served by the local FastAPI backend) and insert selected
 * file contents into the ChatGPT input box.
 */
(function () {
  "use strict";

  const API_BASE = "http://127.0.0.1:8787";
  const STORAGE_KEY = "clb_selected_files";

  // ---- state ----
  let projects = [];
  let currentProject = -1;
  let treeCache = null;
  let selectedFiles = new Set();
  let panelEl = null;
  let toggleBtn = null;

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
        <div class="clb-header">
          <select id="clb-project-select"><option value="-1">选择项目…</option></select>
          <button class="clb-btn" id="clb-refresh" title="刷新文件树">↻</button>
        </div>
        <div class="clb-actions">
          <button class="clb-btn primary" id="clb-insert">插入选中文件</button>
          <button class="clb-btn" id="clb-insert-all-text">插入全部文本文件</button>
          <button class="clb-btn" id="clb-copy-bundle">复制为 Markdown</button>
          <span style="flex:1"></span>
          <button class="clb-btn" id="clb-uncheck-all">全不选</button>
        </div>
        <div id="clb-tree">
          <div style="padding:12px;color:#888">请先选择项目并刷新</div>
        </div>
        <div class="clb-status" id="clb-status">就绪</div>
      </div>
    `;
    document.body.appendChild(root);

    panelEl = root.querySelector("#clb-panel");
    toggleBtn = root.querySelector("#clb-toggle");

    toggleBtn.addEventListener("click", () => {
      panelEl.classList.toggle("open");
      if (panelEl.classList.contains("open") && projects.length === 0) {
        loadProjects();
      }
    });

    root.querySelector("#clb-project-select").addEventListener("change", (e) => {
      currentProject = parseInt(e.target.value, 10);
      treeCache = null;
      selectedFiles.clear();
      if (currentProject >= 0) loadTree();
    });

    root.querySelector("#clb-refresh").addEventListener("click", () => {
      if (currentProject >= 0) loadTree();
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
  // API
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
      sel.innerHTML = '<option value="-1">选择项目…</option>';
      projects.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = p.exists ? p.name : `${p.name} (路径不存在)`;
        if (!p.exists) opt.disabled = true;
        sel.appendChild(opt);
      });
      setStatus(`共 ${projects.length} 个项目`);
    } catch (e) {
      setStatus(`连接失败: ${e.message}。请确认本地服务器已启动 (端口 8787)。`, true);
    }
  }

  async function loadTree() {
    try {
      setStatus('<span class="clb-spinner"></span>加载文件树…');
      const data = await api(`/api/tree?project_index=${currentProject}`);
      treeCache = data.tree;
      // Pre-select all text files by default (the backend already marked them checked)
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
    // Root children
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
      // Click on folder name also toggles
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
  // Insert / copy bundle
  // ------------------------------------------------------------------
  async function insertBundle(files) {
    try {
      setStatus('<span class="clb-spinner"></span>读取文件内容…');
      const data = await api("/api/bundle", {
        method: "POST",
        body: JSON.stringify({ project_index: currentProject, files }),
      });
      const text = data.bundle;
      setStatus(`已生成 ${data.count} 个文件的合并文本，正在插入…`);

      const ok = await insertIntoChatInput(text);
      if (ok) {
        setStatus(`✅ 已插入 ${data.count} 个文件 (${text.length} 字符)`);
      } else {
        // Fallback: copy to clipboard
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
      const data = await api("/api/bundle", {
        method: "POST",
        body: JSON.stringify({ project_index: currentProject, files }),
      });
      await navigator.clipboard.writeText(data.bundle);
      setStatus(`✅ 已复制 ${data.count} 个文件 (${data.bundle.length} 字符) 到剪贴板`);
    } catch (e) {
      setStatus(`复制失败: ${e.message}`, true);
    }
  }

  /**
   * Try to insert text into ChatGPT's input box.
   * ChatGPT uses a ProseMirror contenteditable. We try multiple strategies.
   */
  async function insertIntoChatInput(text) {
    // Strategy 1: ProseMirror contenteditable div (current ChatGPT UI)
    const editors = document.querySelectorAll('div[contenteditable="true"]');
    for (const ed of editors) {
      const closest = ed.closest("form");
      // Prefer an editor inside a form (the composer)
      if (closest || ed.getAttribute("id") === "prompt-textarea") {
        if (tryInsertProseMirror(ed, text)) return true;
      }
    }
    // Fallback: any contenteditable
    for (const ed of document.querySelectorAll('div[contenteditable="true"]')) {
      if (tryInsertProseMirror(ed, text)) return true;
    }
    // Strategy 2: textarea (legacy UI)
    const ta = document.querySelector('textarea[data-id="root"]') || document.querySelector("textarea#prompt-textarea");
    if (ta) {
      ta.focus();
      // Use execCommand for textarea
      const ok = document.execCommand("insertText", false, text);
      if (ok) return true;
      // Direct value set
      ta.value = text;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  function tryInsertProseMirror(el, text) {
    el.focus();
    // Try execCommand first — works in many contenteditable setups
    const ok = document.execCommand("insertText", false, text);
    if (ok && el.textContent.length > 0) return true;
    // Fallback: direct DOM manipulation (ProseMirror)
    try {
      // Insert as a single <p> with line breaks preserved
      const lines = text.split("\n");
      const frag = document.createDocumentFragment();
      lines.forEach((line, i) => {
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
