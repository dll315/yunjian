# 云笺 · 诗词与科技简报推送站

一个零依赖 Node 网站：随机拉取古诗词、抓取科技资讯并用可选 AI 整理，然后一键推送到企业微信群机器人。所有配置保存到服务器的 `data/config.json`，部署后访客不需要重复填写。

## 启动

```bash
npm start
# 或
node server.js
```

默认访问 `http://localhost:3210`。可用环境变量调整端口和监听地址：

```bash
PORT=8080 HOST=0.0.0.0 node server.js
```

需要 Node.js 18 或更高版本。项目没有任何第三方运行时依赖。

## 使用

1. 首次打开点“设置”，设置一个至少 4 位的管理密码，并填写企业微信机器人 Webhook。
2. 可选填写 OpenAI 兼容接口的 AI 配置（API 地址、模型、Key），用于 AI 作诗和整理科技简报。
3. 首页“换一首”拉取诗词，“获取简报”抓取并整理科技资讯；两个区域都有“推送”按钮。
4. 推送记录保存在 `data/push-log.jsonl`。

## 定时推送

在设置里启用“定时推送”后，服务端每隔 30 秒检查一次当前时间：

- 推送时间按 `HH:mm` 填写，支持一天多个时间点
- 可同时勾选推送古诗词和科技简报
- 时区默认 `Asia/Shanghai`，部署在境外服务器时可改成对应时区
- 成功推送记录写入 `data/scheduler-state.json`，避免同一时间点重复推送；每次推送同时记录到 `data/push-log.jsonl`

## 配置存储

配置写入 `data/config.json`，包含带盐哈希后的管理密码、企微 Webhook、AI 配置、诗词来源、简报来源和定时推送配置。API Key 保存在服务器本地，前端接口只返回掩码。修改配置需要管理密码。

## 科技简报来源

- Hacker News
- GitHub 新星仓库
- 奇客 Solidot
- 少数派
- InfoQ

可在设置中勾选来源、调整条数，并自定义 AI 整理要求。

## API

- `GET /api/state` 公共状态
- `POST /api/poem` 获取诗词
- `POST /api/brief/refresh` 生成科技简报
- `GET /api/brief` 读取已缓存的简报
- `POST /api/push` 推送 `poem`、`brief` 或 `test`
- `POST /api/settings` 保存配置（需管理密码）
- `POST /api/settings/load` 读取配置（需管理密码）
- `POST /api/auth` 校验管理密码

## GitHub 托管

本项目可以公开托管到 GitHub。仓库中不包含运行时数据：

- `.gitignore` 会忽略 `data/`、`work/` 和日志文件
- 真实的 Webhook、AI Key 和管理员密码哈希都在 `data/config.json`，不要提交到仓库
- 服务器部署时单独把现有 `data/config.json` 放到服务器上的 `./data/` 目录即可

示例：

```bash
git init
git add .
git commit -m "init yunjian"
git remote add origin https://github.com/你的用户名/yunjian.git
git push -u origin main
```

## Docker 部署

项目提供了 `Dockerfile` 和 `docker-compose.yml`，部署到 Linux 服务器时不需要在服务器上安装 Node.js。

服务器上先安装 Docker 和 Compose 插件，然后执行：

```bash
git clone https://github.com/你的用户名/yunjian.git
cd yunjian
mkdir -p data
docker compose up -d --build
```

启动前把已有的 `data/config.json` 上传到服务器目录 `yunjian/data/`。这个文件包含企业微信 Webhook、AI 配置和管理员密码，上传后访客不需要再配置。

常用命令：

```bash
docker compose logs -f
docker compose restart
docker compose down
```

配置存储在 `./data/` 目录，容器重建或升级不会丢失，备份 `data/` 即可。

## GitHub 托管

本项目可以公开托管到 GitHub。仓库中不包含运行时数据：

- `.gitignore` 会忽略 `data/`、`work/` 和日志文件
- 真实的 Webhook、AI Key 和管理员密码哈希都在 `data/config.json`，不要提交到仓库
- 服务器部署时单独把 `data/config.json` 放到服务器上的 `./data/` 目录即可

示例：

```bash
git init
git add .
git commit -m "init yunjian"
git remote add origin https://github.com/你的用户名/yunjian.git
git push -u origin main
```

## Docker 部署

项目提供了 `Dockerfile` 和 `docker-compose.yml`，部署到 Linux 服务器时不需要在服务器上安装 Node.js。

服务器上先安装 Docker 和 Compose 插件，然后执行：

```bash
git clone https://github.com/你的用户名/yunjian.git
cd yunjian
mkdir -p data
docker compose up -d --build
```

启动前把已有的 `data/config.json` 上传到服务器目录 `yunjian/data/`。这个文件包含企业微信 Webhook、AI 配置和管理员密码，上传后访客不需要再配置。

常用命令：

```bash
docker compose logs -f
docker compose restart
docker compose down
docker compose pull
```

配置存储在 `./data/` 目录，容器重建或升级不会丢失，备份 `data/` 即可。
