"""Generate PROJECT_STRUCTURE.png — clean ASCII-tree style project structure."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "PROJECT_STRUCTURE.png")

# Tree: (depth, is_folder, name, note_or_None)
TREE = [
    (0, True,  "chatgpt-local-bridge",  None),
    (1, True,  "extension",              "Chrome 扩展（核心）"),
    (2, False, "manifest.json",          "MV3 配置"),
    (2, False, "content.js",             "注入 chatgpt.com 的面板"),
    (2, False, "panel.css",              "面板样式"),
    (2, True,  "icons",                  None),
    (3, False, "icon16/48/128.png",      "扩展图标"),
    (1, True,  "server",                 "FastAPI 后端（可选）"),
    (2, False, "server.py",              "文件扫描/读取/打包"),
    (2, False, "config.json",            "多项目路径配置"),
    (2, False, "requirements.txt",       "fastapi / uvicorn / pydantic"),
    (2, True,  ".venv",                  "虚拟环境（git 已排除）"),
    (1, False, "start.ps1",              "一键启动脚本"),
    (1, False, "README.md",              "使用说明（双模式）"),
    (1, False, ".gitignore",             "排除 .venv / __pycache__"),
    (1, False, "PROJECT_STRUCTURE.png",  "本图 — 可直接给 ChatGPT"),
    (1, False, "scripts/gen_structure.py", "本图的生成脚本"),
]

# Palette
W, M = 1100, 50
BG = (255, 255, 255)
BOX_DIR = (230, 241, 251)
STROKE_DIR = (24, 95, 165)
BOX_FILE = (247, 249, 250)
STROKE_FILE = (180, 178, 169)
TXT_DIR = (24, 95, 165)
TXT_FILE = (44, 44, 42)
TXT_NOTE = (120, 118, 110)
TXT_CONNECT = (200, 198, 188)

# Fonts
def find(*paths, size):
    for p in paths:
        if p and os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

F_TITLE = find("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", size=22)
F_BODY = find("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", size=14)
F_BODY_B = find("C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/msyh.ttc", size=14)
F_NOTE = find("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", size=12)
F_SMALL = find("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", size=11)

# Approximate per-char width by category (CJK ~14px @ size 14, ASCII ~7.5px @ size 14)
def text_width(text, font):
    """Use Pillow textlength for reliability."""
    try:
        return d.textlength(text, font=font)
    except Exception:
        bbox = d.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0]

# Layout
ROW_H = 32
TITLE_H = 80
FOOTER_H = 44
INDENT = 28

# Pre-measure (need draw context)
img = Image.new("RGB", (1, 1))
d = ImageDraw.Draw(img)

# Compute box widths
PAD_X = 14
NOTE_GAP = 16

def measure_row(depth, is_folder, name, note):
    name_font = F_BODY_B if is_folder else F_BODY
    nw = text_width(name, name_font)
    nw_total = nw
    note_w = 0
    if note:
        note_w = text_width("  // " + note, F_NOTE)
    return nw_total + note_w + PAD_X * 2 + (NOTE_GAP if note else 0)

# Render
n_rows = len(TREE)
H = TITLE_H + n_rows * ROW_H + FOOTER_H
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# Title
d.text((M, 22), "ChatGPT Local Bridge — 项目结构", font=F_TITLE, fill=TXT_FILE)
d.text((M, 50), "Chrome 扩展 (核心) + FastAPI 后端 (可选)  ·  拖这张图给 ChatGPT 即可秒懂架构",
       font=F_NOTE, fill=TXT_NOTE)

# Helper
def name_x(depth):
    return M + 20 + depth * INDENT

# Collect positions
positions = []
y = TITLE_H
for depth, is_folder, name, note in TREE:
    y_center = y + ROW_H // 2
    positions.append((depth, y_center, is_folder, name, note))
    y += ROW_H

# Draw connectors first
for i in range(1, len(positions)):
    depth_prev, y_prev, _, _, _ = positions[i - 1]
    _, y_cur, _, _, _ = positions[i]
    x_root = name_x(depth_prev) + 14  # connector x near left edge of parent box
    # vertical line from parent's bottom-center to current's top-center
    d.line([(x_root, y_prev + 8), (x_root, y_cur - 8)], fill=TXT_CONNECT, width=1)
    # horizontal stub to current box
    d.line([(x_root, y_cur), (name_x(positions[i][0]) - 6, y_cur)], fill=TXT_CONNECT, width=1)

# Draw boxes + text
for depth, y_center, is_folder, name, note in positions:
    x = name_x(depth)
    name_font = F_BODY_B if is_folder else F_BODY
    name_color = TXT_DIR if is_folder else TXT_FILE

    nw = text_width(name, name_font)
    note_w = 0
    if note:
        note_w = text_width("  // " + note, F_NOTE)
    box_w = nw + note_w + PAD_X * 2 + (NOTE_GAP if note else 0)
    box_h = ROW_H - 10
    box_y = y_center - box_h // 2

    fill = BOX_DIR if is_folder else BOX_FILE
    stroke = STROKE_DIR if is_folder else STROKE_FILE
    d.rounded_rectangle([x, box_y, x + box_w, box_y + box_h], radius=6,
                        fill=fill, outline=stroke, width=1)
    d.text((x + PAD_X, box_y + 5), name, font=name_font, fill=name_color)
    if note:
        d.text((x + PAD_X + nw + NOTE_GAP, box_y + 6), "// " + note, font=F_NOTE, fill=TXT_NOTE)

# Footer
d.text((M, H - 30), "图例：蓝底=文件夹 / 白底=文件 / 灰字=注释  ·  仓库: github.com/chenyb0625-creator/chatgpt-local-bridge",
       font=F_SMALL, fill=TXT_NOTE)

img.save(OUT, "PNG")
print(f"OK -> {OUT}  ({img.size[0]}x{img.size[1]})")
