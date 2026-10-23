# Danbooru 多标签预览

一个纯静态 Danbooru 匿名搜索网页。用户输入 tag 后，网页会直接请求 Danbooru `/posts.json`，并在浏览器中预览图片。

## 功能

- 匿名请求 Danbooru API，不需要后端服务。
- 保留原 Python 脚本的多 tag 思路：默认前 2 个 tag 远程搜索，剩余 tag 本地过滤。
- 默认使用 `All` 评级。
- 白底图片浏览界面，提供专题入口、标签推荐与自适应瀑布流。
- 设置本次目标加载数量；前 2 个 tag 参与远程查询，后续 tag 在浏览器中过滤。
- 历史 tag 最多保留 20 个最近使用的 tag，点击会添加到搜索框；输入后按一次回车即可搜索。
- 按评级、比例、尺寸和得分等条件筛选，支持一键清除筛选。
- 收藏保存在当前浏览器，大图预览支持方向键切换、Esc 关闭与标签反查。
- 浏览设置支持加载数量、默认评级、排序、图库密度和作品信息显示；点击「保存设置」后保留偏好。
- 加载中可停止请求，失败后可重试；图片加载失败时仍可打开原作品。

现有收藏、历史记录和设置沿用原来的本地存储键。升级后无需迁移数据。

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

## 开发检查

```bash
python3 tests/check_static.py
```

固定数据浏览器回归与异常状态测试见 [tests/README.md](tests/README.md)。设计参考原型保留在 [prototypes/pexels-inspired/](prototypes/pexels-inspired/)，正式入口不依赖其脚本或示例图库。
