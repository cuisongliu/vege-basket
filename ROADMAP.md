# Roadmap

本文只记录当前代码和已知风险能够支撑的近期工程工作，不承诺长期产品功能。

## 安全回归覆盖

- 为安装包 Object Key 校验、AI URL 校验、飞书 webhook 鉴权、OAuth fragment 回传和邀请链接撤销补充可重复执行的非数据库测试。
- 在获得隔离数据库写入授权后，为邀请链接接受、撤销、轮换和并发竞争补充事务级集成测试。
- 将部署模板中的加密密钥、AI、飞书和 OSS 凭据改为 Kubernetes Secret 引用，并验证升级时不会把密钥写入普通模板值。

## 会话与数据保护

- 用 HttpOnly、Secure、SameSite Cookie 或一次性 token 交换替代 `localStorage` Bearer 会话，覆盖飞书 OAuth 回跳与邀请链接登录流程。
- 审核新增的交付事件、安装包时间线、操作内容和关联备注，确保所有敏感字段都纳入现有应用层加密与历史明文迁移流程。

## 依赖与结构

- 缩减构建和运行时依赖面，处理仍可从生产路径触达的 `npm audit` 告警，并保持 Docker 运行时依赖与 `package.json` 一致。
- 按认证与账号、飞书集成、安装包市场、项目工作区拆分 `server/index.ts`，按导航视图和项目工作台拆分 `src/App.tsx`，同时保持现有 API 与交互行为不变。
