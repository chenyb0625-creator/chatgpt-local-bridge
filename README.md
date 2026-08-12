# ChatGPT Local Bridge

让网页版 ChatGPT 能浏览并插入你本地项目文件的小工具，免再手动一个个上传。

## 架构

```
本地项目文件 ──→ FastAPI 服务器 (localhost:8787) ──→ Chrome 扩展 ──→ ChatGPT 输入框
```

- **后端** (`server/`)：Python FastAPI，扫描本地目录、读取文件、拼接成 Markdown 块。
- **前端** (`extension/`)：Chrome 扩展，在 `chatgpt.com` 右下角注入悬浮面板。

## 第一步：配置项目

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

## 第二步：启动本地服务器

在 PowerShell 中：

```powershell
cd C:\Users\ASUS\Documents\chatgpt-local-bridge
.\start.ps1
```

首次运行会自动创建虚拟环境并装好依赖（FastAPI、uvicorn）。

启动后看到 `Uvicorn running on http://127.0.0.1:8787` 即成功。让这个窗口保持开着。

## 第三步：安装 Chrome 扩展

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」
4. 选择 `C:\Users\ASUS\Documents\chatgpt-local-bridge\extension` 文件夹
5. 扩展加载成功即可

## 第四步：在 ChatGPT 中使用

1. 打开 `https://chatgpt.com`
2. 右下角会出现蓝色圆形按钮 `{"`
3. 点击展开面板：
   - 顶部下拉框选择项目
   - 自动加载文件树，**默认勾选所有文本文件**
   - 可手动取消勾选不需要的文件
   - 点击「插入选中文件」→ 文件内容（带路径标注）会自动粘贴进 ChatGPT 输入框
   - 也可点「复制为 Markdown」拿到剪贴板，手动粘贴

## 常见问题

**Q: 面板显示"连接失败"？**
A: 本地服务器没启动，或端口被占用。先跑 `.\start.ps1`。

**Q: 扩展面板不出现？**
A: 确认扩展已启用；刷新 `chatgpt.com` 页面。

**Q: 插入失败，提示"已复制到剪贴板"？**
A: ChatGPT 的输入框 DOM 结构可能变了，自动插入没成功。扩展已把内容放到剪贴板，手动 Ctrl+V 粘贴即可。

**Q: 想加新项目？**
A: 编辑 `server/config.json`，加完保存，重启服务器或在面板点刷新按钮。

## 安全

- 服务器只监听 `127.0.0.1`，不对外网暴露。
- CORS 只允许 `chatgpt.com` 和 `localhost`。
- 所有路径都会校验是否在项目根目录内，防止目录穿越。
