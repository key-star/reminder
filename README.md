# 提醒 · Reminder

本地优先的提醒 / 闹钟 / 备忘录工具。

- **电脑端**：Windows 托盘程序 + 本地网页界面。关闭浏览器后，托盘程序仍会按时弹出全屏闹钟。
- **手机端**：可安装的纯 PWA。数据保存在手机浏览器本地，打开 App 时提醒。
- **锁屏提醒（可选）**：开启云端推送后，由你自己的 Cloudflare Worker 定时发送 Web Push；也可以把提醒导出到系统日历。
- **V1 只做一次性提醒**，不做重复规则、账号系统和多设备数据同步。

## 目录

```text
reminder/
├─ web/       Vue 3 + Vite + TypeScript + Pinia + Dexie PWA + Pages Functions
├─ worker/    Cloudflare Worker + D1，可选的 Web Push 后端
└─ desktop/   Python + Flask + SQLite + Tkinter + pystray
```

## 电脑端

### 直接运行源码

环境：Windows 10/11、Python 3.11+、Node.js 20.19+ 或 22.12+。

```powershell
cd E:\workspace\HomemadeTools\reminder\web
npm install
npm run build

cd ..\
python -m pip install -r desktop\requirements.txt
python desktop\app.py
```

启动后会：

1. 在 `127.0.0.1:8765` 启动仅本机可访问的服务；
2. 自动打开浏览器界面；
3. 在系统托盘放一个提醒图标。

关闭浏览器不会退出托盘程序。要退出，右键托盘图标选择「退出」。

托盘菜单：

- 打开界面
- 新建提醒
- 测试闹钟
- 开机自启
- 退出

启动参数：

```powershell
python desktop\app.py --no-open   # 启动时不自动打开浏览器
```

### 数据位置

```text
%APPDATA%\ReminderToolbox\reminder.db   SQLite 数据
%APPDATA%\ReminderToolbox\app.log      运行日志
%APPDATA%\ReminderToolbox\alarm.wav    自动生成的闹钟音
```

卸载时退出托盘程序，删除程序文件；如需彻底清除数据，再删除 `%APPDATA%\ReminderToolbox`。

### 打包为 exe

```powershell
cd E:\workspace\HomemadeTools\reminder
python desktop\build.py
```

产物：

```text
desktop\dist\ReminderToolbox.exe
```

`build.py` 会先构建 `web/dist`，生成图标，再用 PyInstaller 打成单文件窗口程序。

如果已经构建过前端，可以跳过前端构建：

```powershell
python desktop\build.py --skip-web
```

说明：

- exe 没有代码签名，Windows SmartScreen 可能提示未知发布者；选择「更多信息 → 仍要运行」。
- exe 可以移动到其他目录运行，数据仍在 `%APPDATA%\ReminderToolbox`。移动后如果开机自启失效，在设置里关闭再开启一次即可重新写入路径。
- 开机自启写入当前用户注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，不需要管理员权限。

## 手机端 PWA

```powershell
cd E:\workspace\HomemadeTools\reminder\web
Copy-Item .env.example .env.local   # 需要云端推送时填写
npm run build
```

把 `web/dist` 目录中的内容部署到任意 HTTPS 静态托管（Cloudflare Pages、Netlify、GitHub Pages 等）。

安装：

- Android / Chrome：打开网址 → 浏览器菜单 →「安装应用」或「添加到主屏幕」。
- iPhone / Safari：打开网址 → 分享 →「添加到主屏幕」。

数据保存在浏览器 IndexedDB 中。清除浏览器数据会删除提醒，建议定期在设置中导出备份。

### 手机端提醒能力

- **App 打开时**会检查到期提醒，并尽量发系统通知 / 响铃。
- **开启云端推送后**，App 关闭或锁屏也能收到提醒（由 Worker 定时发送 Web Push）。
- **把提醒加入日历后**，由系统日历负责到点提醒，不依赖 App 运行。
- 未开启上述能力时，App 关闭后不会提醒。浏览器后台计时器也可能被系统限流，提醒可能延后。

### 可选：云端推送

原理：设置页开启推送后，浏览器创建 Web Push 订阅；待办提醒（标题、备注、到期时间）会同步到你的 Worker。Worker 每分钟检查一次到期任务，通过 VAPID 推送到已订阅设备。关闭推送会删除订阅和服务端任务。

部署到自己的 Cloudflare 账号：

```powershell
cd E:\workspace\HomemadeTools\reminder\worker
npm install
npx wrangler login

npx wrangler d1 create reminder-push
# 把输出的 database_id 填到 wrangler.toml

npx wrangler d1 execute reminder-push --remote --file schema.sql

npm run vapid
# 生成一对 VAPID 密钥，公钥同时用于 Worker 和前端
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT        # 例如 mailto:you@example.com

# 建议限制为前端站点来源；测试阶段可先用 *
npx wrangler secret put ALLOWED_ORIGIN       # 例如 https://your-site.pages.dev

npx wrangler deploy
```

部署成功后 Wrangler 会显示 Worker 地址，默认形如：

```text
https://reminder-push.<你的账户子域>.workers.dev
```

前端生产构建有两种方式：

1. **推荐：Pages 同源代理**。`web/functions/api/push/[[path]].ts` 会把 `/api/push/*` 转发到 Worker，前端只需请求同源路径，不依赖 `workers.dev` 是否可访问。
   - 把文件里的 `WORKER_ORIGIN` 改成你的 Worker 地址。
   - `web/.env.production` 保持 `VITE_PUSH_API_URL=/api/push`，并填入 Worker 的 VAPID 公钥。
   - 在 `web` 目录构建后执行 `npx wrangler pages deploy dist --project-name <Pages项目名> --branch main`；Wrangler 会同时上传 `functions` 目录。
2. **直连 Worker**。把 `VITE_PUSH_API_URL` 设为 `https://reminder-push.<你的账户子域>.workers.dev/api/push`，适合能正常访问 `workers.dev` 的网络。

本地开发仍用 `web/.env.local` 指向 `http://127.0.0.1:8787/api/push`。部署后在手机设置页点「开启」并允许通知，再点「发送测试推送」验证。

推送限制：

- 需要 HTTPS；除 localhost 外不安全的来源无法订阅。
- iPhone 需要 iOS 16.4+，并且必须先「添加到主屏幕」后才能使用 Web Push。
- Cron 最小间隔为 1 分钟，实际触发可能延迟；24 小时内到期的任务会补发，更早的任务会直接标记为已处理，避免反复扫描。
- `clientId` 是同步凭据：知道它的人可以读写该客户端的推送任务。请勿分享，公开部署时建议用 `ALLOWED_ORIGIN` 限制来源，并在 Cloudflare 侧配置限流。
- `workers.dev` 在部分网络不可访问；优先使用 Pages 同源代理，或给 Worker 绑定自己的域名。

## 数据与备份

电脑和手机的数据互相独立，不会自动同步。云端推送只是把待办任务单向发送给 Worker 用于定时提醒，不会把手机数据同步回本地，也不会在设备之间合并提醒。

设置页支持：

- **导出备份**：下载 JSON 文件。
- **导入备份 - 合并**：保留双方数据，同一 `id` 按 `updated_at` 取较新的一条。
- **导入备份 - 覆盖**：清空当前数据后导入。
- **清空所有提醒**：不可恢复，建议先导出。

备份格式：

```json
{
  "app": "reminder",
  "version": 1,
  "exported_at": 1700000000000,
  "reminders": []
}
```

## 开发

### 前端

```powershell
cd web
npm run dev          # http://localhost:5173
npm run typecheck
npm test
npm run build
```

`npm run dev` 会把 `/api` 代理到 `http://127.0.0.1:8765`，所以可以先启动 `python desktop/app.py`，再启动 Vite 开发服务器。

也可以强制存储模式：

- `http://localhost:5173/?mode=desktop`：强制使用电脑端 API。
- `http://localhost:5173/?mode=local`：强制使用 IndexedDB，方便只调试 PWA。

本地调试云端推送时，先启动 Worker，再把 `web/.env.local` 配成：

```dotenv
VITE_PUSH_API_URL=http://127.0.0.1:8787/api/push
VITE_VAPID_PUBLIC_KEY=<worker/.dev.vars 中的公钥>
```

### 云端推送后端

```powershell
cd worker
npm install
Copy-Item .dev.vars.example .dev.vars   # 填入 VAPID 和 ALLOWED_ORIGIN
npm run dev                             # http://127.0.0.1:8787
npm run typecheck
npm test
```

测试覆盖接口校验、订阅增删、同步分块、定时推送、失效订阅清理和异常兜底。

### 电脑端测试

```powershell
cd E:\workspace\HomemadeTools\reminder
python -m unittest discover -s desktop\tests -v
```

覆盖数据库增删改查、逾期处理、稍后提醒、导入导出和 Flask API。

## 已知限制

- 电脑端目前只支持 Windows（Tk 全屏窗口、`winsound`、注册表自启）。
- 只支持一次性提醒；数据模型预留了 `repeat` 字段，但 V1 不提供重复规则。
- 没有账号和多设备数据同步；云端推送只负责单向发送提醒。
- 本地 HTTP 服务只监听 `127.0.0.1`，没有登录鉴权；不要把它暴露到局域网或公网。
- 不开启云端推送、也不加入日历时，手机 PWA 关闭后不会提醒。
- 手机通知权限因浏览器和系统而异；iPhone 需要 iOS 16.4+ 且安装到主屏幕后才支持 Web Push。
- 云端推送依赖自建 Worker 和 D1，Cron 触发可能有分钟级延迟。

## 隐私

默认情况下，提醒内容只保存在本机 SQLite（电脑）或浏览器 IndexedDB（手机），程序没有遥测。

只有在你主动开启云端推送后，应用才会把**待办提醒的标题、备注、到期时间**以及浏览器的推送订阅信息上传到**你自己的** Cloudflare Worker/D1，用于定时发送通知；不会发送给第三方。关闭推送会删除服务端订阅和任务。电脑端只会访问 `127.0.0.1` 上的本地服务。
