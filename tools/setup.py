#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""发布前的一次性初始化：把所有 YOUR_NAME / 占位符替换成你真实的 GitHub 路径。

用法：
    python3 tools/setup.py --user yourname --repo 6bt0-unlock [--author 你的昵称]

会改写：
    userscript/6bt0-vip.user.js   的 @namespace/@homepageURL/@updateURL/@downloadURL/@author
    README.md                     里的安装链接
    bookmarklet/build.py          的默认值（然后自动重新生成 dist/）
"""
import argparse, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = [
    "userscript/6bt0-vip.user.js",
    "README.md",
    "bookmarklet/build.py",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    ap.add_argument("--repo", default="6bt0-unlock")
    ap.add_argument("--author", default=None)
    a = ap.parse_args()

    for rel in TARGETS:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        s = open(p, encoding="utf-8").read()
        s = s.replace("YOUR_NAME/6bt0-unlock", f"{a.user}/{a.repo}")
        s = s.replace("YOUR_NAME", a.user)
        if a.author:
            s = re.sub(r"// @author\s+.*", f"// @author       {a.author}", s)
            s = s.replace("Copyright (c) 2026 6bt0-unlock contributors",
                          f"Copyright (c) 2026 {a.author}")
        open(p, "w", encoding="utf-8").write(s)
        print("✔", rel)

    print("\n重新生成书签：")
    subprocess.run([sys.executable, os.path.join(ROOT, "bookmarklet", "build.py"),
                    "--user", a.user, "--repo", a.repo], check=False)
    print("\n下一步：")
    print("  git init && git add . && git commit -m 'init'")
    print(f"  git remote add origin git@github.com:{a.user}/{a.repo}.git && git push -u origin main")


if __name__ == "__main__":
    main()
