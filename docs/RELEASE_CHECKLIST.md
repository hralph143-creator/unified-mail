# Windows 发布前检查清单

## 自动化检查

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:responsive
```

全部成功后再运行 `pnpm package:win`。安装包输出到 `release-delivery/`，该目录不提交 Git。

## 发布阻断项

- 按 `REAL_MAIL_ACCEPTANCE.md` 完成 QQ、163、126 和至少一种标准 IMAP 服务的人工验收。
- 使用专用测试账户验证单封及批量 `\\Seen` 回写，不得在未授权的真实邮箱执行批量已读。
- 配置受信任的 Windows 代码签名证书并签名安装器。当前仓库没有证书，禁止提交 `.pfx`、`.p12`、`.pem` 或 `.key` 文件。
- 在干净的 Windows 10 与 Windows 11 x64 环境安装、启动、升级和卸载。
- 检查 SmartScreen、托盘退出、开机启动、休眠恢复和安装目录变更。

## 隐私与安全复核

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` 保持不变。
- Preload 只暴露 `UnifiedMailApi` 中声明的能力；所有 IPC 输入均经过校验。
- 检查提交内容不含数据库、WAL、日志、授权码、真实邮件、附件和证书。
- 确认日志不记录授权码、正文和附件内容；分享日志前仍需人工脱敏邮箱地址。
- HTML 邮件继续使用 DOMPurify、CSP 和远程图片限制。
- 附件只能由用户选择路径后保存，不能自动打开或执行。

## 当前已知限制

- 没有 Windows 商业代码签名证书，安装器可能触发 SmartScreen。
- 自动同步只在应用/托盘进程运行时执行，关机期间不会同步。
- 服务商认证、风控、限流和 UIDVALIDITY 行为只能通过真实账户人工验证。
- 本地凭据安全依赖 Windows 当前登录会话；无法抵御已经控制该会话的攻击者。
