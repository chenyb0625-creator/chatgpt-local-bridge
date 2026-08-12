# ChatGPT / DeepSeek Local Project Bridge

让网页版 ChatGPT / DeepSeek 能浏览并插入你本地项目文件的小工具，免再手动一个个上传。

> 🗂 **关键特性**：每次插入文件时，会自动在开头附带一份**项目结构树**，让 AI 一眼看懂目录层级关系，再结合代码上下文理解你的项目。
> 想看这个工具自身的结构？看 [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) 或 [`PROJECT_STRUCTURE.png`](PROJECT_STRUCTURE.png)（可视化版，可直接拖进 ChatGPT）。

## 两种使用模式

### 模式 A：直接选目录（推荐，无需服务器）

面板顶部点「📂 选择工作目录」→ 弹出系统文件夹选择框 → 选定项目目录后，扩展**直接在浏览器里读取文件**（走 Chrome 的 `webkitdirectory` 原生能力），不需要启动任何本地服务。

### 模式 B：服务器模式（可选，支持配置的多项目）

本地 FastAPI 服务器 + 面板下拉框切换已配置项目，适合固定项目集合。

```
本地项目文件 ──→ FastAPI 服务器 (localhost:8787) ──→ Chrome 扩展 ──→ ChatGPT 输入框
```

---

## 模式 A：直接选目录（最快上手）

1. 安装扩展（见下文「安装扩展」）
2. 打开 `https://chatgpt.com` 或 `https://chat.deepseek.com`
3. 点右下角蓝色 `{"` 按钮展开面板
4. 点「📂 选择工作目录」→ 选你的项目文件夹
5. 文件树自动加载，**默认勾选所有文本文件**（二进制/超大文件自动排除）
6. 点「插入选中文件」→ 内容开头会自动带上**项目结构树**（如 `my-project/ ├── src/ │ ├── main.py ...`），再拼上每个文件的代码，自动进输入框
7. 只想让 AI 先看结构？点「插入项目结构」单独插入目录树
8. 也可「复制 Markdown」手动粘贴

> 小提示：目录选择后浏览器会提示「此网站想查看文件夹」，选"查看"即可。这是 Chrome 的安全机制，文件只在你本机浏览器里读取，不会被上传到任何地方。

## 模式 B：服务器模式（多项目切换）

### 1. 配置项目

编辑 `server/config.json`，在 `projects` 数组里加上你的项目：

```json
{
  "projects": [
    { "name": "我的前端", "path": "C:/Users/xxx/code/my-frontend" },
    { "name": "后端 API", "path": "C:/Users/xxx/code/my-api" }
  ],
  "port": 8787,
  "max_file_size_kb": 512
}
```

### 2. 启动本地服务器

在 PowerShell 中：

```powershell
cd C:\Users\ASUS\Documents\chatgpt-local-bridge
.\start.ps1
```

首次运行会自动创建虚拟环境并装好依赖（FastAPI、uvicorn）。

启动后看到 `Uvicorn running on http://127.0.0.1:8787` 即成功。让这个窗口保持开着。

### 3. 使用

展开面板后，在顶部下拉框选择项目（下拉框第一项是 `[服务器模式]` 提示；不选下拉框时默认就是模式 A）。

---

## 安装扩展

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」
4. 选择 `C:\Users\ASUS\Documents\chatgpt-local-bridge\extension` 文件夹
5. 扩展加载成功即可

## 常见问题

**Q: 模式 A 选择目录后没反应？**
A: Chrome 会先弹「查看文件夹」确认框，需点允许；另外扩展改动后要在 `chrome://extensions/` 点扩展上的「刷新」图标重新加载。

**Q: 模式 B 面板显示"连接失败"？**
A: 本地服务器没启动，或端口被占用。先跑 `.\start.ps1`。

**Q: 插入失败，提示"已复制到剪贴板"？**
A: ChatGPT 的输入框 DOM 结构可能变了，自动插入没成功。扩展已把内容放到剪贴板，手动 Ctrl+V 粘贴即可。

**Q: 想加新项目（模式 B）？**
A: 编辑 `server/config.json`，加完保存，重启服务器或在面板点刷新按钮。

## 安全

- 模式 A：文件在你的浏览器里由 File API 读取，只用于粘贴到 ChatGPT 输入框，不上传任何服务器。
- 模式 B：服务器只监听 `127.0.0.1`，不对外网暴露；CORS 只允许 `chatgpt.com` 和 `localhost`；路径校验防目录穿越。
