# 乐也教学管理系统 V1.0（开发中）

本分支在原微信小程序预约 MVP 基础上增量升级。旧版 `courses` 与 `bookings` 数据表保留，历史预约记录不删除；新版核心流程为负责人建档、线下沟通、后台排课、确认授课后手动消课、线下收款与家长只读查看。

## 技术栈
- 微信原生小程序（WXML / WXSS / JavaScript）+ Vant Weapp
- Node.js 20+ / Express 4
- SQLite（better-sqlite3），编号 SQL migrations
- 管理端 Web 页面与家长微信小程序共用后端 API
- 工作室时区：`America/Chicago`；数据库时间保存 UTC

## 后端启动

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

编辑 `.env`：
- `PORT`：默认 3000
- `ADMIN_TOKEN`：仅供本地开发的管理 API 令牌，必须替换为随机长密钥
- `CORS_ORIGIN`：开发可按需配置，生产必须设置为明确来源
- `DB_PATH`：SQLite 文件路径
- `WX_APP_ID` / `WX_APP_SECRET`：微信小程序登录及手机号验证所需服务端凭证

启动时会自动运行 `backend/migrations/*.sql`。迁移只增量创建新表和索引，不删除旧表。请在升级前备份数据库。

## 管理后台

启动后访问：

`http://localhost:3000/admin/management.html`

开发版管理后台可以创建家庭、学员、教师、教室、课程、课程商品和订单；登记分次线下收款；授权提前开通；安排单次或每周固定课程；确认实际上课并消课；登记一次性退款。

当前管理后台仍使用开发期 `ADMIN_TOKEN`。它不是正式生产身份认证方案，不得直接公开部署。

## 家长小程序

1. 使用微信开发者工具导入 `miniprogram` 目录。
2. 配置 `miniprogram/config.js` 中的后端地址。模拟器可用本机地址；真机必须使用手机可访问的局域网地址或 HTTPS 域名。
3. 服务端配置 `WX_APP_ID` 和 `WX_APP_SECRET`。
4. 家长通过微信登录并授权手机号；负责人先建立家庭和孩子档案、添加监护人手机号，家长完成身份验证后，负责人审核家庭关联。
5. 审核通过后，家长可以切换孩子查看课表、成长记录、课时和通知。

家长端不提供自主预约、线上购买、在线支付、线上请假或补课预约。续费由线下沟通完成，负责人在管理端新增课时权益批次。

## 已落地的主要 API

- `POST /api/auth/wechat-login`：微信登录换取服务端会话
- `POST /api/auth/phone`：微信手机号验证及家庭监护人账号关联
- `GET /api/parent/students`：当前监护人获授权的孩子
- `GET /api/parent/students/:studentId/schedule`
- `GET /api/parent/students/:studentId/growth`
- `GET /api/parent/students/:studentId/entitlements`
- `GET /api/parent/notifications`
- `GET/POST /api/admin/v1/families`
- `GET/POST /api/admin/v1/students`
- `GET/POST /api/admin/v1/teachers`
- `GET/POST /api/admin/v1/rooms`
- `GET/POST /api/admin/v1/courses`
- `POST /api/admin/v1/courses/:id/products`
- `POST /api/admin/v1/orders`
- `POST /api/admin/v1/orders/:id/payments`
- `POST /api/admin/v1/orders/:id/early-activate`
- `POST /api/admin/v1/orders/:id/refund`：登记退款审批，冻结剩余权益但不伪记为已退款
- `POST /api/admin/v1/orders/:id/refund/complete`：线下实际退款完成后登记实际金额与差异原因
- `GET /api/catalog/courses`：家长端只读课程目录（与旧预约课程表分离）
- `POST /api/admin/v1/lessons`：单次课次，带资源冲突检查
- `POST /api/admin/v1/lesson-series`：生成未来 12 周固定课次
- `POST /api/admin/v1/lesson-series/:id/extend`：滚动补充未来课次
- `POST /api/admin/v1/lessons/:lessonId/students/:studentId/confirm`
- `POST /api/admin/v1/lessons/:lessonId/students/:studentId/consume`

所有管理 API 使用 `Authorization: Bearer ADMIN_TOKEN`。家长 API 使用微信登录返回的会话 token，并且每次按监护人授权关系检查孩子权限。

旧预约数据只保留给负责人查看。公开预约提交和仅凭手机号查询接口已关闭，历史记录没有删除。

## 测试

```bash
cd backend
npm test
```

GitHub Actions 会在功能分支 push 和 PR 时运行后端测试。

## 当前尚未完成 / 不可直接生产上线

- 管理员正式账号、会话和角色权限；当前管理令牌仅开发使用。
- 管理后台完整列表、编辑、调课、请假和停课操作体验。
- 家长端真机验证、订阅消息模板与通知触发。
- 成长记录的负责人审核/发布管理界面。
- 课时更正冲正界面、退款操作员身份和凭证附件。
- 备份恢复自动化、部署配置、HTTPS 与小程序合法域名。
- 微信真实凭证配置后，必须用实际小程序账号完成登录、手机号授权和家庭绑定验收。

**不要将开发版管理后台或当前分支作为正式生产系统直接对外开放。**


## 需求对照与对抗式验收

完整的角色权限、家长端边界、排课冲突、实际授课、课时账本、订单退款、数据迁移与生产部署验收矩阵见 [`docs/ACCEPTANCE-AND-ADVERSARIAL-TESTS.md`](docs/ACCEPTANCE-AND-ADVERSARIAL-TESTS.md)。该文档明确区分已实现、部分实现与未完成项目；自动测试通过不代表全部业务验收通过。
