# Danbooru 多标签预览

一个纯静态 Danbooru 匿名搜索网页。用户输入 tag 后，网页会直接请求 Danbooru `/posts.json`，并在浏览器中预览图片。

## 功能

- 匿名请求 Danbooru API，不需要后端服务。
- 保留原 Python 脚本的多 tag 思路：前 1 到 2 个 tag 远程搜索，剩余 tag 本地过滤。
- 默认只显示 `Safe` 评级。
- 支持设置页数、每页数量、远程 tag 数和评级。
- 点击图片可以打开大图预览。

## 本地打开

直接打开 `index.html` 即可。也可以用任意静态服务器预览：

```bash
python3 -m http.server 4173
```

然后访问：

```text
http://localhost:4173
```

## GitHub Pages 部署

1. 把本目录提交到 GitHub 仓库。
2. 在仓库 `Settings -> Pages` 中将 `Source` 设置为 `GitHub Actions`。
3. 推送到 `main` 或 `master` 分支后，`.github/workflows/deploy-pages.yml` 会自动发布。

Danbooru 的接口当前允许跨域访问，因此 GitHub Pages 上不需要额外代理服务。
