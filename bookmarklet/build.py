#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把油猴脚本打包成一行书签（bookmarklet）。

用法：
    python3 bookmarklet/build.py --user 你的GitHub用户名 --repo 6bt0-unlock

产出（dist/ 目录）：
    bookmarklet-loader.txt   推荐：书签里放这一行，每次从 jsDelivr 拉最新脚本
    bookmarklet-inline.txt   离线版：整个脚本塞进书签，不依赖 CDN

用法：把 txt 里的全部内容复制，新建一个书签，URL 粘贴进去即可。
"""
import argparse
import os
import re
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "userscript", "6bt0-vip.user.js")
OUT = os.path.join(ROOT, "dist")


def strip_meta(code: str) -> str:
    return re.sub(r"^\s*//\s*==UserScript==.*?//\s*==/UserScript==\s*", "", code, flags=re.S)


def minify(code: str) -> str:
    # 极简压缩：去整行注释、去行首尾空白、去空行。保留字符串里的内容。
    lines = []
    for ln in code.splitlines():
        s = ln.strip()
        if not s or s.startswith("//"):
            continue
        lines.append(s)
    out = "\n".join(lines)
    out = re.sub(r"\n{2,}", "\n", out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="Yanqing797")
    ap.add_argument("--repo", default="6bt0-unlock")
    ap.add_argument("--branch", default="main")
    a = ap.parse_args()

    code = open(SRC, encoding="utf-8").read()
    body = strip_meta(code)
    os.makedirs(OUT, exist_ok=True)

    # 1) loader 版：从 jsDelivr 拉
    cdn = f"https://cdn.jsdelivr.net/gh/{a.user}/{a.repo}@{a.branch}/userscript/6bt0-vip.user.js"
    # 多源回退：GreasyFork CDN → jsDelivr → GitHub raw
    gf = ("https://update.greasyfork.org/scripts/604404/"
          "6bt0%EF%BC%88%E4%B8%8D%E5%A4%AA%E7%81%B5%EF%BC%89%20%E4%BC%9A%E5%91%98"
          "%E8%A7%A3%E9%94%81%20%2B%20%E7%BD%91%E7%9B%98%E7%9B%B4%E9%93%BE%E5%AF%BC%E5%87%BA.user.js")
    raw = f"https://raw.githubusercontent.com/{a.user}/{a.repo}/{a.branch}/userscript/6bt0-vip.user.js"
    loader = (
        "javascript:(function(){if(window.__6bt0unlockLoaded)return;window.__6bt0unlockLoaded=1;"
        "var srcs=['" + gf + "','" + cdn + "','" + raw + "'],i=0;"
        "function go(){if(i>=srcs.length){alert('脚本加载失败，检查网络或改用 inline 版');return;}"
        "var s=document.createElement('script');s.src=srcs[i++];s.onerror=go;"
        "document.body.appendChild(s);}go()})()"
    )
    open(os.path.join(OUT, "bookmarklet-loader.txt"), "w", encoding="utf-8").write(loader)

    # 2) inline 版：整段塞进去
    mini = minify(body)
    inline = "javascript:(function(){" + mini + "})()"
    open(os.path.join(OUT, "bookmarklet-inline.txt"), "w", encoding="utf-8").write(inline)

    print("✔ dist/bookmarklet-loader.txt  (%.0f 字符)" % len(loader))
    print("✔ dist/bookmarklet-inline.txt  (%.0f 字符)" % len(inline))
    print("\n把文件内容整段粘进书签的 URL 字段即可（不要加换行）。")
    if a.user == "Yanqing797":
        print("⚠ 记得先替换 --user/--repo 成你真实的 GitHub 仓库路径。")


if __name__ == "__main__":
    main()
