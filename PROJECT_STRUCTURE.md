# ChatGPT Local Bridge — 项目结构

> 把这张图（或下面的文本树）发给 ChatGPT，让它秒懂整个工具的架构。

## 文本版（可直接复制粘贴）

```
chatgpt-local-bridge/
├── extension/                       # Chrome 扩展（核心）
│   ├── manifest.json                # MV3 配置
│   ├── content.js                   # 注入 chatgpt.com 的面板逻辑
│   ├── panel.css                    # 面板样式
│   └── icons/
│       └── icon16/48/128.png        # 扩展图标
│
├── server/                          # FastAPI 后端（可选）
│   ├── server.py                    # 文件扫描/读取/打包 API
│   ├── config.json                  # 多项目路径配置
│   ├── requirements.txt             # fastapi / uvicorn / pydantic
│   └── .venv/                       # 虚拟环境（已被 .gitignore 排除）
│
├── start.ps1                        # 一键启动脚本（仅服务器模式需要）
├── README.md                        # 使用说明
├── .gitignore                       # 排除 .venv / __pycache__
├── PROJECT_STRUCTURE.png            # 本图 — 可视化版
├── PROJECT_STRUCTURE.md             # 本图 — 文本版
└── scripts/
    └── gen_structure.py             # 上面两张图的生成脚本
```

## 关键概念

| 文件 / 目录 | 作用 | 是否必装 |
|---|---|---|
| `extension/content.js` | 在 chatgpt.com 右下角注入面板，处理"选择目录"和文件读取 | 必装 |
| `extension/manifest.json` | Chrome MV3 扩展声明 | 必装 |
| `server/server.py` | 旧方案：本地 HTTP 服务，提供多项目下拉 | 可选 |
| `server/config.json` | 旧方案：项目路径配置 | 可选 |
| `start.ps1` | 旧方案：一键启动本地服务 | 可选 |

## 数据流

```
本地文件夹 ──→ [Chrome 扩展面板：FileReader] ──→ Markdown 文本块 ──→ ChatGPT 输入框
```

（默认无服务器模式；旧服务器模式：`本地文件夹 → FastAPI → fetch → ChatGPT`）
