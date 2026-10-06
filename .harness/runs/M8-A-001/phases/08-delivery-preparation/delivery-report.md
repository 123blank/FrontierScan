# M8-A 交付准备报告

> Story：`M8-A-001`
>
> 状态：`ready`
>
> Git：`not-requested`

## 1. 交付结论

M8-A 已完成配置、Schema、Provider Runtime、Codex CLI Adapter、专项测试、真实只读审核、
文档和知识概览收口。受控 manifest 绑定 38 个 Story owned 文件，未执行 `git add`、
`git commit`、`git push`、PR、发布或部署。

最终受控 manifest：

```text
.harness/runs/M8-A-001/delivery/owned-manifest.json
sha256:4f9459afac7613696e577e4899b736a4b9ce459322c88032458bcd9d4e691b4c
```

## 2. Owned 文件分类

- Provider 配置与模型路由：`.harness/config/agent-providers.json`、配置 Schema 和
  `provider-config.mjs`。
- Provider 数据与执行契约：request、context、response、execution receipt Schema，
  `provider-contract.mjs` 和 `provider-context.mjs`。
- Provider 执行：`provider-runtime.mjs`、`provider-adapters/codex-cli.mjs` 和
  `run-provider.ps1`。
- Runtime 集成：dispatch、Story、E2E、Worker 契约与对应测试。
- 文档与知识：M8-A DESIGN/REPORT、长期目标、路线、结构清单、交接文档和知识概览。
- 安全配置：`.gitignore` 忽略本地 Provider 覆盖文件。

## 3. 预测外修改

以下 5 个文件是实施和真实审核中证明必要的直接依赖，已作为 owned 文件保留并单独披露：

```text
.harness/schemas/dispatch-result-v2.schema.json
.harness/scripts/lib/dispatch-contract.mjs
.harness/scripts/lib/worker-runtime.mjs
docs/harness-m8a-review-provider/DESIGN.md
llm-knowledge/overview.md
```

## 4. 无关工作区修改

```text
docs/harness-m8a-review-provider/PLAN.md
```

该文件在 Story 初始化前已经 dirty，期间按用户要求持续勾选。由于 baseline 没有保存初始
文件字节，无法安全拆分前后修改，因此继续列为 unrelated，不进入 owned manifest。

## 5. 剩余风险与边界

本 Story 没有阻止交付准备的剩余风险。以下是明确延期能力，不表示当前实现缺陷：

- backend/frontend 写入型开发 Provider。
- 跨供应商 HTTP Adapter。
- 严格操作系统级读取 ACL。
- Worktree、并行、Fork-Join 和自动 Git。

`done/completed` 仅表示业务开发和交付准备闭环完成，不表示已经提交或推送。
