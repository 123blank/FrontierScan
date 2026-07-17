# M4-A 接口验证报告

## 环境

本 Story 验证 Windows `codex-cli 0.144.1` 的 prompt context、项目文件注册关系和 Harness 确定性脚本，不涉及 backend API、frontend UI 或部署环境，因此不启动产品服务。

`derive-interface-cases.ps1` 从 DAG 生成 8 个草案。T2 的 DAG 类型为 `integration`，辅助脚本默认生成 `api-or-ui-flow`；根据技术设计，本阶段将其按真实 CLI/文件接口重新分类为 `manual-check`。

## 验证用例

| 用例 | 操作 | 预期 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
| T1-C1 | 检查 M4-A 设计和计划 | 包含 CLI 目标、正负对照、决策、范围和审核门槛 | 对应章节完整 | 通过 |
| T2-C1 | 三次解析仓库内 `<skills_instructions>` | 每次发现同一组 13 个项目 Skill | 13/13/13，集合和 locator 一致 | 通过 |
| T2-C2 | 在仓库外目录使用相同解析规则 | 不发现 FrontierScan Skill | 发现 0 个 | 通过 |
| T2-C3 | 对照 Skill 目录/frontmatter/注册表和 Agent/workflow | 13 个 Skill、12 个角色、8 个 owner 一致 | 全部一致 | 通过 |
| T3-C1 | 检查报告和结构化映射 | 结论有证据且覆盖 12 角色 | 报告及映射证据完整 | 通过 |
| T3-C2 | 检查交接和架构说明 | 不再描述为未验证，不声称 Worker 已实现 | 两项均满足 | 通过 |
| T4-C1 | 检查结构、Smoke、知识和 no-build 证据 | 当前门禁通过 | unit-test 与 build-publish 证据均为通过 | 通过 |
| T4-C2 | 检查 phase 5 审核报告 | 无未解决 `BLOCKER/WARNING` | 未发现未解决问题 | 通过 |

## 失败诊断

无失败用例。产品 API/UI 验证不适用，因为业务源码和业务契约没有变化。

## 证据

- `.harness/runs/M4-A-001/phases/03-implementation/evidence/skill-discovery.json`
- `.harness/runs/M4-A-001/phases/03-implementation/evidence/registry-check.json`
- `.harness/runs/M4-A-001/phases/03-implementation/evidence/agent-runtime-mapping.json`
- `.harness/runs/M4-A-001/phases/04-unit-test/test-report.md`
- `.harness/runs/M4-A-001/phases/05-code-review/code-review-report.md`
- `.harness/runs/M4-A-001/phases/06-build-publish/build-report.md`

## 结论

M4-A 的 CLI 和文件接口验收通过，产品 API/UI 验证不适用，可以进入只读 Git 交付摘要阶段。
