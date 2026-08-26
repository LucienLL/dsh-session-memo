# dsh-session-memo

DSH（DeepSeek Harness）Web UI 插件 —— 对话侧边备忘录：把当前会话工作区的 **GitHub 同步状态 / npm 发布状态 / 项目版本 / 手动备忘标签** 汇总到一个可随时呼出的浮动面板。

- 自动探测（host 端实时计算，不落盘）：git 分支与 ahead/behind/dirty、npm registry 最新版对比、package.json 版本。
- 手动数据（host 端 settings 持久化，跨会话/跨浏览器）：版本覆盖、备注、标记已发布、备忘标签。
- 与 [dsh-session-status](https://github.com/LucienLL/dsh-session-status)（对话状态标签）弱联动：面板头部显示当前会话状态并可点按切换；未安装该插件时自动隐藏状态区，不影响其他功能。

## 使用

1. 在 DSH Web 对话头部点击 **📋** 按钮，弹出右侧备忘录面板（打开时自动探测一次，另有手动刷新）。
2. 面板内容：
   - **GitHub 同步**：分支、上游、ahead/behind、未提交改动数、冲突数、最近提交、远程地址。`behind>0 || dirty>0` 时状态为琥珀色（文案如「落后 2 · 3 个未提交」），有冲突显示红色，完全同步显示绿色「已同步」。
   - **npm 发布**：包名、本地版本 vs registry latest；落后时提示「可发布新版本」；可用「标记已发布」手动记录发布时间（自动比对仍会显示实际状态）。
   - **项目版本**：默认显示自动探测值，可手动输入覆盖（回车/失焦保存，「恢复」回到自动探测）。
   - **备注**：自由文本，失焦自动保存。
   - **备忘标签**：自由文本标签增删。
   - **状态**（弱联动）：面板头部显示 dsh-session-status 的当前状态 pill，点击按「进行中 → 已结项 → 搁置中 → 无」循环切换。

## 安装

```powershell
# 在你的 DSH profile 下（以 web 为例）
dsh plugin --profile web add dsh-session-memo
# 或本地开发（在仓库目录内执行）：
dsh plugin --profile web add .
```

重启 `dsh web` 后生效。

## 原理（host + browser 双面）

| 侧 | 文件 | 职责 |
| --- | --- | --- |
| host | `lib/index.js` | 注册 settings namespace `dsh-session-memo` + `GET /dsh-session-memo/probe` 路由 |
| host | `lib/memo.js` | 纯逻辑（git porcelain 解析 / semver 对比 / package.json 解析）+ `MemoService` 编排（git 只读探测、fs 读 package.json、fetch npm registry） |
| browser | `lib/client.js` | `conversation.session.header.actions` 入口按钮 + `shell.overlay` 浮动面板 + `settingsScope` 读写 |

- 权限边界：git 只读命令（如 `status --porcelain=v1 -b` / `log -1` / `remote -v` / `rev-parse --show-toplevel`），绝不写仓库；npm 只 GET registry；fs 只读 package.json。
- 探测只在打开面板 / 手动刷新时执行，不常驻轮询；每次 git 命令 graceMs=5000 超时兜底；npm 查询 8s 超时，失败仅降级该字段。
- 数据流：自动探测结果不落盘；手动覆盖/标签/备注写 settings namespace（schema: `{ overrides: {<sessionId>: {version,note,publishedAt}}, tags: {<sessionId>: string[]} }`）。

## 开发与验证

```powershell
node --check lib\index.js lib\memo.js lib\client.js
node test\memo.test.mjs      # 纯逻辑单测（git 解析/semver/package.json）
node test\probe.test.mjs     # MemoService 编排单测（假 subprocess/fs）
node test\client-shape.test.mjs  # client inject 契约（服务名，非包名）
node test\client-apply.test.mjs  # 槽位注入 + namespace 绑定契约（锁住面板实际能否出现）
node test\probe-smoke.mjs    # 真实 npm registry 冒烟（可选，需网络）
```

组合验证：`dsh --profile web --patch <repo>\cordis.patch.yml --dump-config` 应输出 `- id: dsh-session-memo` 行。

## 发布

```powershell
pwsh -File scripts\publish-interactive.ps1   # 交互式终端：npm WebAuthn 设备流（需先配置 npm token）
```

发布清单见 `RELEASE.md`。

## License

MIT
