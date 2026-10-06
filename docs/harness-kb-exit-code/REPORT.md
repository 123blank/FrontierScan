# Harness 知识生成退出码修复报告

> 日期：2026-07-16
> 分支：`fix/harness-kb-exit-code`
> 结果：修复完成

## 1. 问题与影响

`.harness/scripts/generate-kb.ps1` 调用 Node.js 生成器后直接结束。PowerShell 5.1 不会自动把原生命令的 `$LASTEXITCODE` 作为脚本退出码，因此 Node.js 写入失败时，外部调用仍可能收到 0。

该行为会使 CI、Harness 或人工自动化把失败的知识刷新误判为成功。

## 2. 修复

Node.js 调用结束后立即保存退出码，并在非零时使用同一个退出码结束 PowerShell 脚本：

```powershell
& node @arguments
$nodeExitCode = $LASTEXITCODE
if ($nodeExitCode -ne 0) {
  exit $nodeExitCode
}
```

成功路径的输出、参数和退出码保持不变。

## 3. TDD 证据

- RED：测试把 `llm-knowledge` 创建为普通文件，使 Node.js 生成器确定性失败；旧包装器仍返回 0，测试报 `Missing expected rejection`。
- GREEN：增加退出码传播后，失败路径返回非零，完整 `generate-kb.test.mjs` 回归通过。
- 回归测试同时保留既有 PowerShell 单模块成功路径，确保正常生成仍返回 0 并输出合法 JSON。

## 4. 文件范围

- 修改：`.harness/scripts/generate-kb.ps1`
- 修改：`.harness/scripts/tests/generate-kb.test.mjs`
- 新增：`docs/harness-kb-exit-code/PLAN.md`
- 新增：`docs/harness-kb-exit-code/REPORT.md`

未修改 `backend/src/**`、`frontend/src/**`、知识生成核心、模型配置或知识产物。

## 5. 验证命令

```powershell
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
git status --short -- backend/src frontend/src
```

## 6. 验收结果

| 验收项 | 结果 |
| --- | --- |
| 知识生成完整回归 | 通过 |
| 失败退出码回归 | 通过，Node.js 失败被 PowerShell 作为非零返回 |
| 成功入口回归 | 通过，单模块生成返回 0 且 JSON 可解析 |
| 结构校验 | 通过：16 个目录、102 个文件、13 个 Skill |
| Harness 冒烟 | 通过 |
| 知识新鲜度 | backend、frontend、common 均为 fresh |
| `git diff --check` | 通过，仅有 Windows 行尾提示 |
| 业务源码审计 | `backend/src/**`、`frontend/src/**` 差异为空 |
