# 乐也微信小程序 · MVP v2

本项目是可本地运行、可继续开发的微信小程序基础源码，按“先把预约与教务核心链路做可靠”的原则设计。

## 产品边界
- 家长端：品牌首页、课程浏览、试听/咨询预约、预约状态查看（演示版本地记录）
- 工作室端：轻量管理后台，可查看预约、确认/拒绝预约
- 后端：课程 API、预约 API、管理 API、SQLite 持久化
- 不包含微信支付；线下收款后由工作室管理员登记并开通课程的正式学员模块属于下一阶段
- 不包含真实微信登录。当前以开发期匿名预约为基础，正式上线前必须接入 `wx.login` + 服务端身份校验

## 技术栈
- 微信原生小程序：WXML / WXSS / JavaScript
- Node.js 20+
- Express 4
- SQLite（better-sqlite3）

## 目录
```text
miniprogram/       小程序源码
backend/           API 服务、数据库、管理后台
```

## 1. 启动后端
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```
默认 `http://localhost:3000`。首次启动自动创建 `data/leye.sqlite` 并写入演示课程。

环境变量：
- `PORT`：服务端端口，默认 3000
- `ADMIN_TOKEN`：管理后台 API 密钥，必须在运行前修改
- `CORS_ORIGIN`：允许的来源；开发默认 `*`，生产环境必须设置为实际来源/域名
- `DB_PATH`：数据库文件路径，默认 `./data/leye.sqlite`

## 2. 运行小程序
1. 微信开发者工具导入 `miniprogram` 目录。
2. 打开 `miniprogram/config.js`，将 `apiBase` 改为后端地址。
3. 本地模拟器可使用 `http://127.0.0.1:3000`（开发者工具需关闭合法域名校验）。
4. 真机需使用手机可访问的局域网 IP 或 HTTPS 测试域名；正式版必须配置 HTTPS 合法域名。
5. 点击“预约”提交后，数据会写入后端 SQLite。

## 3. 管理后台
启动后访问 `http://localhost:3000/admin`。
在后台输入 `.env` 中的 `ADMIN_TOKEN`，即可加载预约并更新状态。
后台当前仅适用于可信的本地/测试环境。生产部署前应换成微信管理员登录、服务端会话、权限分级、CSRF 防护和审计日志；不要将管理令牌公开或写入小程序。

## 4. API
- `GET /api/health`
- `GET /api/courses`
- `POST /api/bookings`
- `GET /api/bookings/:id`（通过预约编号和联系电话后四位查询，演示用途）
- `GET /api/admin/bookings`（Bearer 管理令牌）
- `PATCH /api/admin/bookings/:id`（Bearer 管理令牌；状态 `pending|confirmed|declined|completed`）

预约提交字段：`studentName`、`guardianName`（可选）、`phone`、`courseId`、`preferredDate`（可选）、`preferredTime`（可选）、`note`（可选）。

## 5. 正式上线前的必做事项
- 接入微信登录、用户/监护人身份绑定与权限控制
- 配置 HTTPS、微信合法域名、生产 CORS
- 预约查询改为登录后仅可查看本人预约
- 后台采用安全身份认证，不使用静态共享 token
- 增加预约时间冲突、教师/教室资源校验
- 隐私政策、个人信息收集告知与用户授权流程
- 数据备份、监控、限流、日志、异常告警
- 真实业务测试、微信审核与发布

## 测试
```bash
cd backend
npm test
```
