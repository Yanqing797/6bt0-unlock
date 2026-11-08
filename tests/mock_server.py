#!/usr/bin/env python3
# 本地 mock：模拟 6bt0 的几个接口，用于离线测试 userscript（不接触真实站点）
import json, base64, io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    from PIL import Image, ImageDraw
    _has_pil = True
except Exception:
    _has_pil = False

STATE = {"vip": 1, "expire": None, "token": None, "orders": {}}


def captcha_img():
    if not _has_pil:
        return ""
    im = Image.new("RGB", (250, 62), (245, 245, 248))
    d = ImageDraw.Draw(im)
    d.text((70, 22), "13 + 4 =", fill=(20, 40, 90))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


PAGE = """<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>mock 6bt0</title></head><body style="font-family:sans-serif;padding:24px">
<h2>Mock 影视管理系统</h2><p>影片：空枪 (2026) · idcode 37508847</p>
<p>这里模拟站点页面，用于离线验证 userscript。</p></body></html>"""

VIDEO = {
    "title": "空枪", "years": "2026",
    "movies_online_seed": {
        "ali": [{"seed_name": "空枪 V 2026", "link": "https://www.alipan.com/s/MOCK1", "code": ""},
                {"seed_name": "空枪 4K", "link": "", "code": "", "need_vip": 1}],
        "xunlei": [{"seed_name": "空枪 4K 高码", "link": "https://pan.xunlei.com/s/MOCK?pwd=abcd", "code": "abcd"}],
        "quark": [{"seed_name": "空枪 1080", "link": "", "code": "", "need_vip": 1}],
    },
    "all_seeds": [], "ecca": {},
}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _q(self):
        return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

    def _json(self, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json;charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _html(self, s):
        b = s.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html;charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path).path
        q = self._q()

        if u == "/notify":
            oid = q.get("out_trade_no")
            if oid in STATE["orders"] and q.get("trade_status") == "TRADE_SUCCESS":
                STATE["orders"][oid] = "paid"
                STATE["vip"] = 2
                STATE["expire"] = "2099-12-31 23:59:59"
                body = b"success"
            else:
                body = b"fail"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if u.startswith("/prod/api/v1/"):
            ep = u.rsplit("/", 1)[-1]
            tok = q.get("access_token")

            if ep == "getCaptcha":
                return self._json({"code": 200, "data": {"key": "mockkey", "img": captcha_img()}})

            if ep == "reg":
                if q.get("code") != "17":
                    return self._json({"code": 2150, "message": "验证码错误"})
                STATE["token"] = "mocktoken"
                return self._json({"code": 200, "message": "注册成功", "data": {"access_token": "mocktoken"}})

            if ep == "login":
                if q.get("code") != "17":
                    return self._json({"code": 2150, "message": "验证码错误"})
                STATE["token"] = "mocktoken"
                return self._json({"code": 200, "data": {"access_token": "mocktoken"}})

            if ep == "getInfo":
                if tok != "mocktoken":
                    return self._json({"code": 10103, "message": "接口鉴权失败"})
                return self._json({"code": 200, "data": {"user": {
                    "id": 1, "username": "mockuser", "nickname": "mockuser",
                    "is_vip": STATE["vip"], "vip_expire_at": STATE["expire"],
                    "is_permanent_vip": 1 if STATE["vip"] == 2 else 0, "vip_type": None,
                }}})

            if ep == "payOrder":
                if tok != "mocktoken":
                    return self._json({"code": 10103, "message": "接口鉴权失败"})
                oid = "MOCK" + str(len(STATE["orders"]) + 1000)
                STATE["orders"][oid] = "pending"
                return self._json({"code": 200, "data": {"order_id": oid, "url": "https://pay.example/mock"}})

            if ep == "getVideoDetail":
                v = json.loads(json.dumps(VIDEO))
                for k, arr in v["movies_online_seed"].items():
                    if STATE["vip"] != 2:
                        for it in arr:
                            if it.get("need_vip"):
                                it["link"] = ""
                    else:
                        for it in arr:
                            it["link"] = it["link"] or "https://pan.mock/" + it["seed_name"]
                return self._json({"code": 200, "data": v})

            return self._json({"code": 2100, "message": "您访问的资源不存在"})

        return self._html(PAGE)


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    print("mock on", port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
