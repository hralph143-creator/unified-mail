# UnifiedMail 项目记忆

> 更新日期：2026-10-31（Asia/Shanghai）
> 用途：供后续开发者或 AI 在重新进入项目时快速恢复上下文。事实以当前代码与测试结果为准。

## 1. 项目目标

UnifiedMail 是 Windows 10/11 本地桌面应用，用于统一管理多个 QQ、网易 163、网易 126 及标准 IMAP 邮箱。当前产品只展示未读邮件；打开详情不会自动标记已读，只有用户主动执行“标记已读”或“一键已读”时才向原邮箱服务器写入 `\\Seen`。

核心原则：

- 邮箱授权码、邮件正文和附件只保存在本机，不经过云端中转。
- 已读状态必须先得到服务器确认，再更新本地状态；失败时保留或恢复为未读。
- 渲染进程不能直接访问 Node.js、数据库或文件系统，所有能力通过受控 Preload API 与严格 IPC 校验提供。
- 同一账户的同步和已读写回通过互斥锁串行执行，避免状态竞争。

## 2. 技术栈与入口

- Electron 39、Vue 3、Pinia、Naive UI、TypeScript、Vite。
- SQLite（`better-sqlite3`）与 Drizzle 数据结构。
- IMAP 使用 `imapflow`，邮件解析使用 `mailparser`。
- HTML 邮件由 DOMPurify 清理，并受 CSP 与远程图片限制。
- 主进程入口：`electron/main/index.ts`。
- 桌面窗口与托盘：`electron/main/desktop.ts`。
- IPC 注册：`electron/main/ipc/`。
- 业务服务：`electron/main/services/`。
- Preload API：`electron/preload/index.ts`。
- 共享类型：`shared/types.ts`。
- Vue 界面：`src/`。
- 核心测试：`tests/`；响应式桌面验收：`scripts/responsive-smoke.mjs`。
- 打包启动验收：`scripts/packaged-smoke.mjs`；Windows 实测记录：`docs/WINDOWS_ACCEPTANCE.md`。

## 3. 当前已实现的重要能力

### 邮箱与同步

- 多账户绑定、连接测试、启停、重新授权和删除。
- 统一未读收件箱、单账户筛选、搜索、排序和分页。
- 邮件身份使用“账户 + 文件夹 + UIDVALIDITY + UID”，避免重复入库。
- 增量同步会获取完整未读 UID 集合进行对账，但只下载新邮件内容；单次最多拉取 500 封，剩余邮件后续继续同步。
- 后台同步遇到网络、DNS、超时或限流会自动重试一次。
- 全局同步允许账户部分失败，不阻塞其他账户。
- 设置中的默认收件箱已生效。

### 已读与附件

- 单封“标记已读”会回写服务器，失败时恢复本地状态。
- 顶部已有“一键已读”：
  - 在单账户收件箱中只处理该账户。
  - 在统一收件箱中按账户分别批量回写。
  - 每批最多 500 个 UID。
  - 某个账户失败不会撤销其他账户的成功结果；失败账户保持未读并显示警告。
  - 无未读邮件、正在同步或正在批量处理时按钮禁用。
- 附件按需加载与保存，缓存采用带容量限制的 LRU 思路；附件数据库主键冲突问题已修复。

### 界面与窗口

- 布局为连续流式响应：侧栏、列表和详情列使用 `clamp()`、百分比及最小宽度共同分配空间。
- 720–860 像素宽度使用列表/详情单页切换；900 像素以上显示双栏。
- 主界面强制铺满 `100dvh`，不得在窗口底部留下空白。
- 已验证尺寸：720×600、860×680、900×700、1024×768、1080×720、1360×840、1920×1080、2560×1440。
- “立即同步”的图标与文字必须保持白色高对比，不能被工具栏通用灰色文字规则覆盖。
- 标题栏右上角三个窗口按钮为应用自绘按钮，不再使用 Windows 原生覆盖按钮。
- 新手引导出现时：
  - 右上角按钮外观和颜色不能改变。
  - 三个按钮必须无法点击。
  - 遮罩必须统一覆盖标题栏控制区。
  - 引导关闭后恢复正常操作。
- 窗口按钮操作经 IPC 执行；引导期间主进程同时关闭最小化、最大化和关闭能力，退出应用前会恢复，避免阻塞正常退出。

## 4. 用户明确强调的体验要求

后续修改必须保留以下要求：

1. “适配各种屏幕”指动态、连续的响应式布局，不是只针对少数断点硬编码，也不能通过整页 `zoom` 造成高度截断。
2. 窗口无论多大都要铺满可视区域，底部不能出现应用容器之外的空白。
3. 模态引导出现时，右上角按钮必须“颜色不变且不能点击”；不要重新启用原生标题栏覆盖按钮。
4. 主要操作按钮文字要清晰，尤其“立即同步”必须为白字蓝底。
5. 完成功能后应运行真实构建与自动化测试，不只做静态代码检查。

## 5. 测试与常用命令

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:responsive
pnpm test:packaged
```

也可执行：

```powershell
run.bat --check
```

最近一次已知结果：

- TypeScript 类型检查通过。
- ESLint 通过。
- Vitest：4 个测试文件、45 项测试通过。
- 生产构建通过。
- 响应式验收的 8 种尺寸全部通过。
- 2026-10-31 全量 npm 审计发现 22 项公告：高危 8、中危 9、低危 5、严重 0；完成受控升级和回归前不得公开发布。
- Windows NSIS 安装包构建、解包版和当前主机安装版启动冒烟通过；辅助安装、快捷方式和正式卸载清理已实测。安装器仍未进行商业代码签名。
- 响应式脚本还会检查：界面全高、无横向溢出、单双栏切换、窄屏返回按钮、窗口控制按钮在模态状态下不变色且不可点击、“立即同步”白色文字，以及“一键已读”按钮完整显示。

## 6. 当前 Git 状态

- 本轮发布验证开始时的基线提交：`a33d8f655b5fd8e2790c5f2d46ac3e9c4d7445a2`。
- 本轮可靠性、响应式、协议模拟、Windows 安装验收和发布文档改动应作为同一阶段归档；实际归档提交以 `git log` 最新记录为准。
- `scripts/responsive-smoke.mjs` 是正式验收脚本，不应被当作临时文件删除。
- 不要用 `git reset --hard`、`git checkout --` 或 `git clean -fd` 丢弃工作区内容。

## 7. 关键实现位置

- 动态布局与窗口按钮样式：`src/styles.css`。
- 主界面、引导状态和一键已读提示：`src/App.vue`。
- 邮件列表顶部操作按钮：`src/components/MailList.vue`。
- 前端邮件状态：`src/stores/mail.ts`。
- 一键已读 IPC：`electron/main/ipc/mails.ts`、`electron/main/ipc/validation.ts`。
- 一键已读本地状态与部分失败处理：`electron/main/services/mails.ts`。
- IMAP 批量 `\\Seen`：`electron/main/services/imap.ts`。
- 自绘窗口操作与模态锁定：`electron/main/ipc/index.ts`、`electron/main/desktop.ts`、`electron/main/index.ts`。
- 共享 API 契约：`shared/types.ts`。
- 同步/已读集成测试：`tests/sync.test.ts`。
- IPC 输入校验测试：`tests/ipc-validation.test.ts`。
- IMAP 协议兼容模拟：`tests/imap-compat.test.ts`。
- 桌面服务、开机启动和附件覆盖取消：`tests/desktop-services.test.ts`。

## 8. 后续建议

- 用真实 QQ、163、126 和自定义 IMAP 账户执行 `docs/REAL_MAIL_ACCEPTANCE.md`，重点验证批量 `\\Seen`、UIDVALIDITY 变化、授权过期和限流行为。
- 正式发布前配置 Windows 代码签名证书，并重新生成安装包。
- 在干净 Windows 10 x64、Windows 11 x64 和真实授权测试邮箱上完成剩余人工验收。
- 对 Electron、Drizzle 及构建/解析依赖公告逐项复核，采用受控升级，不做无回归验证的跨大版本替换。
- 若继续增加批量操作，沿用“服务器确认后更新本地、账户级部分失败隔离、操作中禁用重复点击”的模式。
