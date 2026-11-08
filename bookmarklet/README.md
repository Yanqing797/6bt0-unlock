# 书签版（不想装油猴时用）

```bash
python3 bookmarklet/build.py --user 你的GitHub用户名 --repo 6bt0-unlock
```

会生成两个文件：

| 文件 | 说明 |
|---|---|
| `dist/bookmarklet-loader.txt` | **推荐**。书签里只放一小段 loader，每次从 jsDelivr 拉线上最新版，仓库更新即生效 |
| `dist/bookmarklet-inline.txt` | 离线版。整个脚本（约 16KB）塞进书签，不依赖任何 CDN |

## 用法

1. 打开生成出来的 `.txt`，**全选复制**（不要带换行）
2. 浏览器书签栏 → 右键 → 添加网页/新建书签
3. 名称随便写（比如 `6bt0解锁`），URL 一栏**粘贴那一整段**
4. 打开影片站，点一下这个书签，右下角就会出现面板

> Chrome 新建书签时如果 URL 框自动补 `https://`，把前面那段删掉再粘。
> iOS Safari 可以先把这段存成「书签」再在站点上点地址栏输入关键词触发（Safari 的书签搜索）。
