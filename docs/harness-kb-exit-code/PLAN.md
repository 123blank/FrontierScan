# Harness 知识生成退出码修复计划

> 日期：2026-07-16
> 分支：`fix/harness-kb-exit-code`
> 范围：仅修复 `.harness/scripts/generate-kb.ps1` 的 Node.js 退出码传播
> 状态：已完成并通过验收

## 1. 问题

`generate-kb.ps1` 执行 Node.js 核心后未显式返回 `$LASTEXITCODE`。当生成器因权限、路径或数据错误退出非零时，PowerShell 脚本仍可能向调用方返回 0，导致 CI、Harness 和人工脚本误判成功。

## 2. 根因

PowerShell 5.1 不会自动把最后一个原生命令的非零退出码作为脚本退出码。当前包装器在 `& node @arguments` 后直接结束，丢失了 Node.js 的失败状态。

## 3. TDD 步骤

1. 构造无法作为目录使用的 `llm-knowledge` 路径，触发 Node.js 确定性失败。
2. 通过 PowerShell 入口执行生成器，先确认测试因退出码仍为 0 而失败。
3. 在 Node 调用后保存 `$LASTEXITCODE`，非零时使用相同退出码退出。
4. 验证失败路径返回非零、成功路径仍返回 0。
5. 运行知识生成、结构、冒烟和空白检查回归。

## 4. 文件边界

- 修改：`.harness/scripts/generate-kb.ps1`
- 修改：`.harness/scripts/tests/generate-kb.test.mjs`
- 新增：`docs/harness-kb-exit-code/PLAN.md`
- 新增：`docs/harness-kb-exit-code/REPORT.md`

不修改业务源码、知识生成核心、API 配置、模型配置或生成产物。
