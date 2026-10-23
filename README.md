# 提醒 · Reminder

本地优先的提醒 / 闹钟 / 备忘录工具。

- **电脑端**：Windows 托盘程序 + 本地网页界面。关闭浏览器后，托盘程序仍会按时弹出全屏闹钟。
- **手机端**：可安装的纯 PWA。数据保存在手机浏览器本地，打开 App 时提醒。
- **V1 只做一次性提醒**，不做重复规则、云端同步和账号系统。

## 目录

```text
reminder/
├─ web/       Vue 3 + Vite + TypeScript + Pinia + Dexie PWA
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
npm run build
```

把 `web/dist` 目录中的内容部署到任意 HTTPS 静态托管（Cloudflare Pages、Netlify、GitHub Pages 等）。

安装：

- Android / Chrome：打开网址 → 浏览器菜单 →「安装应用」或「添加到主屏幕」。
- iPhone / Safari：打开网址 → 分享 →「添加到主屏幕」。

数据保存在浏览器 IndexedDB 中，不会上传到服务器。清除浏览器数据会删除提醒，建议定期在设置中导出备份。

### 手机端 V1 限制

纯 PWA 没有后台原生调度能力：

- **App 打开时**会检查到期提醒，并尽量发系统通知 / 响铃。
- **App 关闭、锁屏或浏览器被系统回收后，不会按时提醒。**
- 浏览器后台计时器也可能被系统限流，提醒可能延后。

如果以后需要手机锁屏也能可靠提醒，需要升级方案，例如原生壳 + 本地通知，或接入推送服务 / 系统日历。V1 不包含这些。

## 数据与备份

电脑和手机的数据互相独立，不会自动同步。

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

### 电脑端测试

```powershell
cd E:\workspace\HomemadeTools\reminder
python -m unittest discover -s desktop\tests -v
```

覆盖数据库增删改查、逾期处理、稍后提醒、导入导出和 Flask API。

## 已知限制

- 电脑端目前只支持 Windows（Tk 全屏窗口、`winsound`、注册表自启）。
- 只支持一次性提醒；数据模型预留了 `repeat` 字段，但 V1 不提供重复规则。
- 没有云同步、账号、多设备实时同步。
- 本地 HTTP 服务只监听 `127.0.0.1`，没有登录鉴权；不要把它暴露到局域网或公网。
- 手机 PWA 关闭后不会提醒，这是 V1 的明确限制。
- 手机通知权限因浏览器和系统而异；iPhone 上 PWA 通知能力也取决于 iOS/Safari 版本。

## 隐私

提醒内容只保存在本机 SQLite（电脑）或浏览器 IndexedDB（手机）。程序没有遥测，也不会上传提醒内容。电脑端只会访问 `127.0.0.1` 上的本地服务。
