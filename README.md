<p align="center">
  <img src="./public/favicon.svg" width="72" alt="Veges 图标">
</p>

# Veges 项目篮子

Veges 是一个面向多项目并行工作的个人项目驾驶舱。它把项目日记、待办、风险、草稿、协作通知、安装包交付记录和 AI 总结放在同一工作区，帮助用户快速恢复上下文并继续推进工作。

## 当前能力

- **项目上下文**：项目状态与标签、按日期维护的日记、风险标记、项目模块、搜索筛选和 Markdown 导出。
- **待办工作流**：跨项目待办、负责人和优先级筛选、确认或驳回、完成时间与完成人、事实时间线、备注、成员提及和图片附件。
- **捕捉与总结**：草稿箱归档、共享 OpenAI 兼容 AI、直接保存的项目日/周总结，以及 Markdown 待办提案审核。
- **协作与通知**：成员邀请、可撤销邀请链接、项目群通知、飞书 OAuth 绑定，以及可订阅的每日待办摘要和站内通知。
- **交付工作台**：项目交付事件、安装包市场、正式/测试版本与架构选择、OSS 临时下载链接、操作时间线、关联待办和时间线导出。

更细的信息组织和用户流见 [docs/ia.md](./docs/ia.md)，产品与视觉基线见 [PRODUCT.md](./PRODUCT.md) 和 [DESIGN.md](./DESIGN.md)。近期工程工作见 [ROADMAP.md](./ROADMAP.md)。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web | React 19、TypeScript、Vite 8、Tailwind CSS 4、Radix UI |
| API | Node.js 24、Express 5 |
| 数据 | PostgreSQL、应用层 AES-256-GCM 加密 |
| 集成 | 飞书开放平台、阿里云 OSS、OpenAI 兼容 AI 接口 |
| 部署 | 多阶段 Docker 镜像、Sealos 应用模板 |

## 本地启动

准备 Node.js 24 和一个可访问的 PostgreSQL 实例，然后安装依赖并创建本地配置：

```bash
npm ci
cp .env.example .env
```

至少设置 `DATABASE_URL`、`APP_ENCRYPTION_ACTIVE_KEY_ID` 和 `APP_ENCRYPTION_KEYS`。可用下面的命令生成 32 字节 Base64 密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

分别启动 API 与 Web 开发服务：

```bash
npm run dev:api
```

```bash
npm run dev
```

默认 Web 地址为 `http://localhost:5173`，Vite 会把 `/api` 代理到 `http://127.0.0.1:8787`。API 启动时会校验加密配置并应用当前数据库结构；`npm run db:init` 会额外写入演示数据，不属于常规启动步骤。

## 环境配置

以 [.env.example](./.env.example) 为配置入口：

| 配置组 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接地址，必填。 |
| `APP_ENCRYPTION_ACTIVE_KEY_ID`、`APP_ENCRYPTION_KEYS` | 敏感字段加密与密钥轮换，必填。 |
| `AI_API_BASE`、`AI_API_KEY`、`AI_MODEL` | 整个实例共用的 OpenAI 兼容模型配置，直接由服务端环境变量注入。 |
| `AI_RATE_*`、`AI_GLOBAL_RATE_LIMIT`、`AI_MAX_*` | 单用户/实例级 AI 请求频率、输入长度和上下文上限。 |
| `FEISHU_*` | 飞书 OAuth、事件回调和通知投递；启用事件回调前必须配置 `FEISHU_VERIFICATION_TOKEN`。 |
| `OSS_*`、`PACKAGE_MARKET_*` | 待办图片、安装包浏览和签名下载；启用对应能力时配置。 |
| `PORT` | API 监听端口，默认 `8787`。 |

> [!CAUTION]
> 不要提交 `.env`、数据库口令、加密密钥、飞书密钥或 OSS 访问凭据。加密密钥丢失后，已有密文无法恢复。

## 安全说明

- 项目、日记、待办、草稿、总结、成员标识和交付记录等敏感字段使用 AES-256-GCM 应用层加密；查询所需的标识使用盲索引。
- AI 服务地址只接受无凭据的 HTTPS 公网地址，并禁止自动跟随重定向。
- 共享 AI 启用后，密码注册必须来自有效项目邀请；飞书 OAuth 登录仍作为企业身份入口。单用户和实例总量使用同一时间窗限流。
- 飞书事件回调在处理 challenge 或事件前校验 verification token；安装包下载只签发规则允许的 OSS Object Key。
- 浏览器当前使用 `localStorage` 保存 Bearer 会话。请避免在不受信任的浏览器环境使用，并将迁移到 HttpOnly Cookie 或一次性交换流程作为上线前加固项。
- `npm run db:encrypt-existing` 会修改数据库，仅用于把历史明文迁移为密文；执行前必须备份数据库并确认完整密钥集合。

## 验证

```bash
npm run lint
npm run build
npm test
git diff --check
```

当前 Node 测试覆盖通知策略、API 错误信息脱敏、OSS Endpoint 规范化、AI Provider 安全、AI 周期与待办提案解析、AI 限流和日报调度。涉及待办并发、摘要任务租约、数据库迁移或历史数据加密的变更，需要在明确授权的隔离数据库中补充集成验证。

## 部署边界

- [Dockerfile](./Dockerfile) 构建前后端并以单个 Node.js 服务监听 `8787`；生产镜像默认发布为 `linux/amd64`。
- [.sealos/template/index.yaml](./.sealos/template/index.yaml) 负责创建 PostgreSQL、应用工作负载、待办日报 CronJob、健康检查、Service 和 TLS Ingress。
- AI、飞书和 OSS 等运行配置与其他服务配置一样，由部署输入直接传入容器环境变量；不要把真实值写入仓库或镜像。
- 提交代码不会自动更新线上实例。部署仍需要构建并发布新镜像、更新模板镜像标签，再执行运行时健康检查。
