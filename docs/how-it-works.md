# 漏洞细节：6bt0 支付回调无签名校验

> 记录时间：2026-11-08。写作目的是说明一条很典型的「支付回调裸奔」问题，供开发自查。

> ⚠️ **2026-11-09 更新：该问题已被站方修复。** `/notify` 现在校验签名，任何伪造请求返回 `fail`，订单不再被置为已支付。
> 本文保留原样，作为完整的问题记录与修复对照。
> 本文不包含任何凭据，文中订单号/账号均为测试期产生的临时数据。

---

## 1. 站点技术栈

- 前端：Vue 3 + Arco Design + axios，接口基址 `/prod/api/v1/`
- 后端：PHP（Laravel 风格：`success/code/message` 信封、`/core/system/*` 路由、`dictData` 字典表）
- 支付：第三方聚合支付（码支付类），网关域名为第三方，回调打到站点 `/notify` 与 `/return`

## 2. 接口契约（从前端打包 JS 逆出）

`assets/index-*.js` 里的请求包装器，把鉴权参数硬编码在客户端：

```js
e.params.app_id   = "83768d9ad4";
e.params.identity = "23734adac0301bccdcb107c4aa21f96c";
const o = "/prod/api/v1/";
const a = localStorage.getItem("token");
if (a) e.params.access_token = a;          // token 同时放 query
headers.Authorization = "Bearer " + a;
```

| 接口 | 方法 | 作用 |
|---|---|---|
| `getCaptcha` | GET | 图形码（**算术题**，如 `10 + 2 =`） |
| `reg` | POST | 注册：`username` + `password` + `repassword` + `email` + `code` + `key` |
| `login` | POST | 登录，返回 JWT |
| `getInfo` | GET | 当前用户（`is_vip` / `vip_expire_at` / `is_permanent_vip`） |
| `updateInfo` | POST | 改资料（**白名单**，改不动会员字段） |
| `getVipList` | GET | 套餐：8 季度 99 / 9 半年 159 / 10 年 288 / 11 永久 599 |
| `payOrder` | GET | 下单：`vip_id` + `type` → `order_id` + 支付跳转 URL |
| `checkPayOrder` | GET | 查订单：`order_id` → `status` / `paid` |
| `getVideoDetail` | GET | 影片详情，含 `movies_online_seed`（网盘）与 `all_seeds`（种子） |

## 3. 核心缺陷

下单后，网关会回调站点：

```
https://www.6bt0.com/notify?app_id=83768d9ad4
```

站点对这个请求**只看了 `out_trade_no` 和 `trade_status`**，没有任何签名/来源/金额校验：

```bash
# 不带 sign、sign_type，甚至金额随便填
curl "https://www.6bt0.com/notify?out_trade_no=<你的订单号>&trade_status=TRADE_SUCCESS&money=599.00&type=1"
# → success
```

随后：

```
checkPayOrder → {"status":2,"paid":true,"pay_at":"..."}
getInfo       → {"is_vip":2,"vip_expire_at":"2036-06-08 18:34:56"}
```

会员时长是「按订单的 `vip_id` 加天数」，永久会员 = 3500 天，所以每伪造一次就往后加 9.6 年。

### 正确的写法应该是

1. 校验 `sign` = `md5(按 key 排序的参与参数 + 商户密钥)`，`sign_type` 必须匹配；
2. 校验 `pid` 是否为自家商户号；
3. 校验 `money` 与订单金额一致；
4. 校验订单当前状态为「待支付」，防重放（幂等）；
5. 回调只回 `success`/`fail`，真正的发货走同一条事务；
6. 服务器侧再主动查一次网关订单（`checkPayOrder` 的语义应该是查网关，而不是查自己库）。

## 4. 试过但没走通的路

| 思路 | 结果 |
|---|---|
| 篡改 JWT 的 `user_id` 冒充他人/管理员 | `10104 接口鉴权失败`，签名真校验 |
| `updateInfo` 批量赋值 `is_vip=2` | 返回「修改成功」但字段白名单，只认 nickname/email/avatar/signed |
| 管理端 `/core/system/getUserList`、`getResourceList` | `2100 您访问的资源不存在`（该构建未暴露） |
| `getVideoDetail?id=1'`、`and 1=1` | `id 必须是数字`，参数强类型，注入不成立 |
| `is_vip=2` 参数污染 | 服务端不信任该参数 |
| `/return` 页面 | 只是展示页，不写库 |

## 5. 另一个信息泄露点

即使不登录，`getVideoDetail` 也会返回 `movies_online_seed`，其中 `need_vip=0` 的条目**直接带网盘直链和提取码**
（每部影片约 3 条最新资源）。登录后种子列表元数据（`all_seeds`，含文件名/大小）也会返回，只是 `zlink` 为空。

也就是说：会员墙是真的（服务端裁剪），但裁剪逻辑只作用在 `link`/`zlink` 字段上，元数据全裸奔。

## 6. 影响面

- 任意人可 0 元获得终身会员，站点付费转化直接归零；
- 可无限叠加时长，订单表被灌入大量脏数据；
- 注册无邮箱验证（`email` 随便填、图形码是算术题），可批量刷号。

## 7. 站方修复建议（按优先级）

1. `/notify` 加签名校验 + 金额校验 + 幂等；
2. 发货逻辑与「标记已支付」放进同一事务，且只在签名通过后执行；
3. 图形码换成非常规算术题或接入人机验证，注册加邮箱验证；
4. `app_id`/`identity` 不应作为唯一客户端凭据（它们已公开在前端）。
