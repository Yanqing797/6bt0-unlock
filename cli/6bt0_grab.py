#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
6bt0（影视管理系统）网盘直链批量提取器
------------------------------------------------------------
原理：GET /prod/api/v1/getVideoDetail?id=<idcode>
      匿名即可返回 movies_online_seed 字段，其中未被 need_vip 锁住的条目直接带
      网盘分享链（ali / quark / xunyun / baidu / 115 / guangdong ...）。
      会员墙只挡住 ecca / all_seeds（种子列表）和 need_vip=1 的条目。

用法：
  python3 6bt0_grab.py 37508847                # 单个影片 idcode（就是 /mv/<数字> 里那个数）
  python3 6bt0_grab.py 37508847 37068446 ...   # 多个
  python3 6bt0_grab.py --latest 20             # 抓最近 20 条影片
  python3 6bt0_grab.py --relay-only 37508847   # 强制走境外中继（本机被反诈跳转时用）

输出：终端分组打印 + 写入 6bt0_links.txt
"""
import sys, json, time, urllib.parse, urllib.request, os, ssl

BASE = "https://www.6bt0.com"
API = "/prod/api/v1/"
Q = {"app_id": "83768d9ad4", "identity": "23734adac0301bccdcb107c4aa21f96c"}
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
RELAY = "https://r.jina.ai/"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "6bt0_links.txt")

TYPE_NAME = {
    "ali": "阿里云盘", "quark": "夸克网盘", "xunlei": "迅雷网盘", "baidu": "百度网盘",
    "115": "115网盘", "guangya": "光鸭云盘", "yidong": "移动云盘", "other": "其他",
}


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read().decode("utf-8", "replace")


def api(path, params=None, relay_only=False):
    """请求接口；本地被 302 到反诈网时自动改走境外中继。"""
    p = dict(Q)
    p.update(params or {})
    qs = urllib.parse.urlencode(p, safe="")
    direct = f"{BASE}{API}{path}?{qs}"

    if not relay_only:
        try:
            body = _get(direct, timeout=25)
            obj = json.loads(body[body.find("{"):])
            if obj.get("code") is not None:
                return obj
        except Exception:
            pass  # 被跳转 / TLS 被断 / 非 JSON → 走中继

    relay = RELAY + direct
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                relay, headers={"User-Agent": UA, "x-respond-with": "text", "x-no-cache": "true"}
            )
            with urllib.request.urlopen(req, timeout=90, context=CTX) as r:
                body = r.read().decode("utf-8", "replace")
            return json.loads(body[body.find("{"):])
        except Exception as e:
            if attempt == 2:
                raise RuntimeError(f"中继失败: {e}")
            time.sleep(2 + attempt * 3)


def detail(idcode):
    return api("getVideoDetail", {"id": idcode})


def latest(n=20):
    r = api("getVideoList", {"limit": n, "page": 1})
    return (r.get("data") or {}).get("data") or []


def collect(d):
    """从 getVideoDetail 的返回里抽出所有带 link 的网盘条目。"""
    seed = d.get("movies_online_seed") or {}
    out, locked = [], 0
    for typ, items in seed.items():
        for it in items or []:
            if it.get("link"):
                out.append({
                    "type": typ,
                    "name": it.get("seed_name") or "",
                    "link": it.get("link"),
                    "pwd": it.get("code") or "",
                    "up": (it.get("updated_at") or "")[:10],
                    "by": it.get("nickname") or "",
                })
            elif it.get("need_vip"):
                locked += 1
    return out, locked


def grab_one(idcode, relay_only=False):
    try:
        r = detail(idcode)
    except Exception as e:
        print(f"[!] {idcode} 请求失败: {e}")
        return
    if r.get("code") != 200 or not r.get("data"):
        print(f"[!] {idcode} 无数据: {r.get('message')}")
        return
    d = r["data"]
    title = d.get("title") or str(idcode)
    items, locked = collect(d)

    print(f"\n=== {title}  ({d.get('years','?')})  idcode={idcode}  "
          f"豆瓣={d.get('doub_score')} IMDb={d.get('IMDB_score')} ===")
    print(f"    可见直链 {len(items)} 条 / 仍锁 need_vip {locked} 条")
    for it in items:
        line = f"[{TYPE_NAME.get(it['type'], it['type'])}] {it['name'][:60]}"
        print(f"    {line}\n        {it['link']}" + (f"  提取码={it['pwd']}" if it['pwd'] else ""))

    with open(OUT, "a", encoding="utf-8") as f:
        f.write(f"\n# {title} ({d.get('years','')}) idcode={idcode}\n")
        for it in items:
            f.write(f"{TYPE_NAME.get(it['type'], it['type'])}\t{it['name']}\t{it['link']}\t{it['pwd']}\n")
    return items


def main():
    args = [a for a in sys.argv[1:]]
    relay_only = "--relay-only" in args
    args = [a for a in args if not a.startswith("--") or a == "--relay-only"]
    if relay_only:
        args = [a for a in args if a != "--relay-only"]

    if sys.argv[1:] and sys.argv[1] == "--latest":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        print(f"拉取最近 {n} 条影片…")
        for v in latest(n):
            code = v.get("idcode") or v.get("id")
            grab_one(code, relay_only)
            time.sleep(1)
        return

    ids = [a for a in args if a not in ("--relay-only",)]
    if not ids:
        print(__doc__)
        return
    for i in ids:
        grab_one(i, relay_only)
        time.sleep(1)


if __name__ == "__main__":
    main()
