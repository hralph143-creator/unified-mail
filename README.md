# UnifiedMail 多邮箱统一管理与双向同步系统

UnifiedMail 是面向 Windows 10/11 的本地桌面应用，用于集中查看多个 QQ、网易 163、网易 126 及标准 IMAP 邮箱中的未读邮件，并把明确的“标记已读”操作写回原邮箱服务器。

## 已实现功能

- 同时绑定多个邮箱账户，支持 QQ、163、126 和手动 IMAP 配置
- 连接测试、授权错误分类、账户启用/停用、重新授权和删除
- 统一未读收件箱、账户筛选、发件人/主题/邮箱搜索、时间排序和分页
- 基于 `账户 + 文件夹 + UIDVALIDITY + UID` 的邮件身份与增量去重；完整对账未读 UID，仅拉取新增邮件内容
- 本系统标记已读后写回服务器 `\Seen`，服务器确认后才更新本地状态
- 支持单账户及统一收件箱“一键已读”，按账户隔离失败并保留未确认状态
- 识别在网页端或其他客户端完成的已读操作
- 正文按需、安全只读加载；HTML 过滤、CSP 限制并默认阻止远程图片
- 附件元数据展示及用户主动保存，不自动执行附件
- 默认启动同步和每 6 小时自动同步，可调整同步周期和默认收件箱
- 后台同步遇到网络、DNS、超时或服务商限流时自动重试一次
- 全局/单账户手动同步、同账户互斥、部分失败不阻塞其他账户
- Windows 托盘、最小化后台、自启动、系统通知和休眠恢复补偿同步
- SQLite WAL 持久化、Drizzle 数据结构、安全 IPC、日志轮转
- Windows 当前用户级 `safeStorage` 凭据加密

## 环境要求

- Windows 10 或 Windows 11（x64）
- Node.js 24
- pnpm 10（项目通过 Corepack 固定为 `pnpm@10.18.3`）

## 开发启动

双击 `run.bat`。首次运行会安装依赖，随后启动桌面应用。

`run.bat` 使用仅含 ASCII 的批处理引导层，再调用 PowerShell 启动器，因此不受 Windows `cmd.exe` 中文代码页影响。

也可以在终端执行：

```powershell
pnpm install
pnpm dev
```

执行完整检查：

```powershell
run.bat --check
```

该命令依次运行严格类型检查、ESLint、Vitest 和生产构建。另可执行 `pnpm test:responsive` 验证 8 种窗口尺寸。测试使用临时 SQLite 数据库与模拟 IMAP 服务，不会连接真实邮箱。

## 添加邮箱

1. 在对应邮箱的网页设置中开启 IMAP 服务。
2. 按服务商流程生成“客户端授权码”；不要填写普通网页登录密码。
3. 在应用左侧点击邮箱账户旁的 `＋`，选择服务商并填写邮箱地址和授权码。
4. 点击“测试连接”；确认成功后点击“连接并保存”。
5. 返回统一收件箱点击“立即同步”，或等待启动同步完成。

QQ、163 和 126 默认使用各自官方 IMAP 主机的 993/TLS 端口。应用不会绕过服务商风控、短信验证或 IMAP 开通限制。

## 数据与安全

- 数据库、日志和配置保存在 Electron 的 Windows 用户数据目录，界面“设置 → 本地数据”会显示确切路径。
- 授权码由 Electron `safeStorage` 使用 Windows 当前用户的系统能力加密后保存在本地数据库，不写入普通配置或日志。
- 这种保护依赖 Windows 登录账户的安全性，不代表能够抵御已经控制当前登录会话的攻击者。
- 渲染界面不具备 Node.js、文件系统或数据库访问权限；所有调用经过受控 Preload API 和 IPC 参数验证。
- 外部链接只允许 `https`、`http` 和 `mailto`，并交给系统默认程序打开。
- 不上传邮箱凭据、正文或附件，也没有云端中转服务。

## 构建安装包

```powershell
pnpm package:win
```

输出：

- `release-delivery/UnifiedMail-1.0.0-Setup.exe`：NSIS 安装器
- `release-delivery/win-unpacked/`：免安装解包目录

当前项目没有商业代码签名证书。未签名安装器在部分 Windows 设备上可能触发 SmartScreen 信誉提示；正式公开发布前应配置受信任的代码签名证书。

## 工程结构

```text
electron/main/          Electron 生命周期、IPC、托盘、调度器
electron/main/db/       Drizzle 表结构、SQLite 初始化与迁移
electron/main/services/ 账户、凭据、IMAP、同步、邮件、设置、日志
electron/preload/       严格受控的渲染进程 API
shared/                 主进程与界面共享类型、服务商配置
src/                    Vue 3、Pinia、Naive UI 桌面界面
tests/                  SQLite + 模拟 IMAP 核心集成测试
scripts/                测试运行器与图标生成脚本
docs/                   用户手册与真实邮箱验收清单
build/                  应用 PNG/ICO 图标
.github/workflows/      GitHub Actions Windows 持续集成
```

## 同步语义

打开邮件详情不会标记已读。只有点击“标记已读”或“一键已读”才会向服务器写入 `\Seen`；如果网络中断、认证失败或服务器未确认，本地仍保留未读并提示错误。自动同步仅在应用或托盘进程运行时执行，电脑关机后不会同步。

## 测试与限制

自动化测试覆盖多账户聚合、增量 UID 对账、账户部分失败、后台自动重试、重复任务复用、外部已读状态、UIDVALIDITY 变化、批量部分确认、异常中断状态恢复、附件缓存淘汰和已读写回失败恢复。真实服务商的认证、风控和服务器行为必须由账户所有者按 [真实邮箱验收清单](docs/REAL_MAIL_ACCEPTANCE.md) 手工验证，模拟测试通过不等于真实邮箱已经验收。发布前事项见 [Windows 发布前检查清单](docs/RELEASE_CHECKLIST.md)。

常见连接问题见 [用户操作与故障排查](docs/USER_GUIDE.md)。
