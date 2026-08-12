"""
ChatGPT Local Bridge - Backend Server
A lightweight FastAPI server that exposes local project files to the browser extension.
"""
import os
import sys
import json
import mimetypes
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONFIG_PATH = Path(__file__).parent / "config.json"

# Binary file extensions to skip by default
BINARY_EXTENSIONS = {
    # Images
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif",
    ".heic", ".heif", ".raw", ".psd", ".ai", ".sketch",
    # Video
    ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg",
    ".mpeg", ".3gp",
    # Audio
    ".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma", ".m4a", ".opus",
    # Archives
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tar.gz", ".tgz",
    ".iso", ".dmg",
    # Executables / binaries
    ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".lib", ".class",
    ".jar", ".war", ".pyc", ".pyd", ".wasm",
    # Documents (binary)
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt",
    ".ods", ".odp", ".epub", ".mobi", ".azw", ".azw3",
    # Databases
    ".db", ".sqlite", ".sqlite3", ".mdb", ".accdb",
    # Fonts
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    # Other
    ".dat", ".bin", ".pak", ".bundle", ".asset", ".proto.bin",
    ".node", ".wasm",
}

# Directories to always skip
SKIP_DIRS = {
    ".git", ".svn", ".hg", "node_modules", "__pycache__", ".venv", "venv",
    "env", ".env", ".idea", ".vscode", ".next", ".nuxt", ".cache",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist", "build", "target",
    "out", ".gradle", ".mvn", ".terraform", "vendor", ".gradle-cache",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {"projects": [], "port": 8787, "max_file_size_kb": 512}
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def is_binary_ext(ext: str) -> bool:
    return ext.lower() in BINARY_EXTENSIONS


def looks_binary(content: bytes) -> bool:
    """Quick heuristic: if first 1024 bytes contain a NUL byte, treat as binary."""
    chunk = content[:1024]
    if b"\x00" in chunk:
        return True
    # Check for UTF-8 decode failure
    try:
        chunk.decode("utf-8")
        return False
    except UnicodeDecodeError:
        return True


def read_gitignore(root: Path) -> list[str]:
    gi = root / ".gitignore"
    patterns = []
    if gi.exists():
        for line in gi.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                patterns.append(line)
    return patterns


def matches_gitignore(rel_path: str, patterns: list[str]) -> bool:
    """Simple .gitignore matching — not a full implementation, but covers common cases."""
    if not patterns:
        return False
    parts = rel_path.replace("\\", "/").split("/")
    name = parts[-1]
    for pat in patterns:
        pat = pat.strip("/")
        # Directory pattern like "node_modules/"
        if pat.endswith("/"):
            base = pat.rstrip("/")
            if base in parts:
                return True
        # Glob with *
        elif "*" in pat or "?" in pat:
            import fnmatch
            if fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(rel_path, pat):
                return True
        # Exact name match (covers both dir and file)
        elif name == pat or pat in parts:
            return True
    return False


def build_tree(root: Path, max_size_kb: int, ignore_patterns: list[str]) -> dict:
    """Recursively build a file tree under root."""
    result = {
        "name": root.name,
        "path": "",
        "type": "dir",
        "children": [],
    }

    def walk(current: Path, node: dict, rel_base: str):
        try:
            entries = sorted(current.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            return
        for entry in entries:
            name = entry.name
            if name in SKIP_DIRS:
                continue
            rel = f"{rel_base}/{name}" if rel_base else name
            if matches_gitignore(rel, ignore_patterns):
                continue
            if entry.is_dir():
                child = {"name": name, "path": rel, "type": "dir", "children": []}
                node["children"].append(child)
                walk(entry, child, rel)
            else:
                ext = entry.suffix.lower()
                size_kb = entry.stat().st_size / 1024
                # Decide if checkable by default
                if is_binary_ext(ext):
                    is_text = False
                    checked = False
                elif size_kb > max_size_kb:
                    is_text = True  # probably text but too big
                    checked = False
                else:
                    # Peek content
                    try:
                        with open(entry, "rb") as f:
                            head = f.read(1024)
                        is_text = not looks_binary(head)
                    except Exception:
                        is_text = False
                    checked = is_text  # default check all text files
                node["children"].append({
                    "name": name,
                    "path": rel,
                    "type": "file",
                    "ext": ext,
                    "size_kb": round(size_kb, 1),
                    "is_text": is_text,
                    "checked": checked,
                })

    walk(root, result, "")
    return result


def read_file_safe(path: Path) -> str:
    """Read file content as text; return error string if failed."""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"[Error reading file: {e}]"


def build_bundle(root: Path, files: list[str]) -> str:
    """Concatenate multiple files into a single markdown block."""
    parts = []
    parts.append("# Project Files Bundle\n")
    parts.append(f"Source: `{root}`\n")
    parts.append(f"Files: {len(files)}\n\n---\n")
    for rel in files:
        abs_path = root / rel
        # Safety: ensure within root
        try:
            abs_path.resolve().relative_to(root.resolve())
        except ValueError:
            parts.append(f"\n## `{rel}`\n\n[Path outside project root — skipped]\n")
            continue
        if not abs_path.exists() or not abs_path.is_file():
            parts.append(f"\n## `{rel}`\n\n[File not found]\n")
            continue
        content = read_file_safe(abs_path)
        lang = abs_path.suffix.lstrip(".") or "text"
        parts.append(f"\n## `{rel}`\n")
        parts.append(f"```{lang}\n{content}\n```\n")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
app = FastAPI(title="ChatGPT Local Bridge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://chatgpt.com",
        "https://chat.openai.com",
        "http://localhost",
        "http://localhost:8787",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BundleRequest(BaseModel):
    project_index: int
    files: list[str]


@app.get("/api/projects")
def list_projects():
    cfg = load_config()
    projects = []
    for i, p in enumerate(cfg.get("projects", [])):
        path = Path(p["path"])
        exists = path.exists() and path.is_dir()
        projects.append({"index": i, "name": p["name"], "path": p["path"], "exists": exists})
    return {"projects": projects}


@app.post("/api/projects")
def add_project(name: str = Query(...), path: str = Query(...)):
    cfg = load_config()
    cfg.setdefault("projects", []).append({"name": name, "path": path})
    save_config(cfg)
    return {"ok": True, "index": len(cfg["projects"]) - 1}


@app.delete("/api/projects/{index}")
def remove_project(index: int):
    cfg = load_config()
    projects = cfg.get("projects", [])
    if 0 <= index < len(projects):
        projects.pop(index)
        save_config(cfg)
        return {"ok": True}
    raise HTTPException(status_code=404, detail="Project index out of range")


@app.get("/api/tree")
def get_tree(project_index: int = Query(...)):
    cfg = load_config()
    projects = cfg.get("projects", [])
    if not (0 <= project_index < len(projects)):
        raise HTTPException(status_code=404, detail="Invalid project index")
    root = Path(projects[project_index]["path"])
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=404, detail="Project path does not exist")
    ignore_patterns = read_gitignore(root)
    tree = build_tree(root, cfg.get("max_file_size_kb", 512), ignore_patterns)
    return {"tree": tree, "ignore_patterns": ignore_patterns}


@app.get("/api/file")
def get_file(project_index: int = Query(...), path: str = Query(...)):
    cfg = load_config()
    projects = cfg.get("projects", [])
    if not (0 <= project_index < len(projects)):
        raise HTTPException(status_code=404, detail="Invalid project index")
    root = Path(projects[project_index]["path"]).resolve()
    target = (root / path).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside project root")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    content = read_file_safe(target)
    return {"path": path, "content": content}


@app.post("/api/bundle")
def bundle_files(req: BundleRequest):
    cfg = load_config()
    projects = cfg.get("projects", [])
    if not (0 <= req.project_index < len(projects)):
        raise HTTPException(status_code=404, detail="Invalid project index")
    root = Path(projects[req.project_index]["path"]).resolve()
    if not root.exists():
        raise HTTPException(status_code=404, detail="Project path does not exist")
    text = build_bundle(root, req.files)
    return {"bundle": text, "count": len(req.files)}


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    cfg = load_config()
    port = cfg.get("port", 8787)
    print(f"[ChatGPT Local Bridge] Starting on http://127.0.0.1:{port}")
    print(f"[ChatGPT Local Bridge] Configured projects:")
    for i, p in enumerate(cfg.get("projects", [])):
        print(f"  [{i}] {p['name']} -> {p['path']}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
