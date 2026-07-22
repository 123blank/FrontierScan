# M5-B2-001 代码审核报告

## 审核范围

- `.harness/scripts/lib/worktree-integration-runtime.mjs`
- `.harness/scripts/run-worktree-integration.ps1`
- `.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- 三个 Worktree integration Schema
- M5-B2 Harness 状态、计划、报告、结构登记、架构和交接文档

未发现无关 dirty files；`backend/src/**`、`frontend/src/**` 无本 Story 修改。

## 已修复发现

1. `WARNING`：首次 Plan 未拒绝 plan 外业务脏文件。已增加 RED，统一通过 Git 业务差异白名单在 Plan/Status/Apply 前失败关闭。
2. `WARNING`：已存 plan 的 artifact 与正式 result 路径可被同时改写。已增加 RED，重复使用时从 M5-B1 receipt、M5-A plan、Git base 和 M3 task 重新推导映射。
3. `WARNING`：Apply 只做一次统一 preflight，后续目标可能覆盖写入间出现的人工修改，receipt 前也缺少最终全量复核。已增加两个竞态 RED，在每次 rename 前重验 base/candidate 前置条件，并在 receipt 写入前重验所有目标 candidate 哈希。
4. `WARNING`：integration receipt 未拒绝 Schema 未声明字段，`taskId` 只检查非空。已增加独立 RED，严格校验 receipt 顶层/文件字段，并在路径推导前验证 Harness identifier。
5. `BLOCKER`：Git blob 原始 LF 字节与 Windows checkout 后工作树字节直接比较，会在 `core.autocrlf=true` 时拒绝 Git 状态干净的现有业务文件。已增加真实临时 Git checkout RED，保留 blob SHA-256 证据绑定，并统一使用 Git 逻辑差异判断 Plan/Status/Apply 的 base 前置条件。

上述修复均先复现失败、再最小修复并重跑完整回归。

## 最终结论

无未解决 `BLOCKER` 或 `WARNING`。

- 内容寻址 bundle、固定 result 路径和所有持久化证据能够相互对账。
- 未确认 Apply、HEAD/证据/bundle 漂移、未解释业务修改、符号链接、未知目标内容和遗留锁均失败关闭。
- 写入顺序、逐文件恢复、result-last、receipt 幂等和 M3 单次显式推进有直接临时 Git fixture 覆盖。
- Runtime 不执行 Git 写操作、M3 apply、merge/remove、发布或部署。
- PowerShell 不暴露任意路径、receipt、bundle、Git ref 或测试钩子。

## 验证证据

- M5-B2：24/24。
- M5-B1：19/19。
- M5-A：11/11。
- M4-B、M3、M2、Harness status、Task DAG、结构、Smoke、知识新鲜度和差异门禁：PASS。
- 正式仓库仅存在 `dev` 主工作树；业务源码 diff 为空。

## 延期边界

断电级 fsync、多文件全局事务、自动回滚、恶意同进程调用方、跨平台 Git 差异和未知临时文件清扫按已确认范围延期，不构成当前 Review finding。
