# M8-B-001 交付归属返工实施记录

## 返工原因

Delivery Runtime 发现旧 implementation result 将初始化前已经 dirty 的
`.harness/structure-manifest.yaml` 和 `PLAN.md` 声明为 actual files。基线不可改写，
因此通过受限 rework 重建 implementation 投影。

## 修改

- 保留 M8-B Development Provider、Codex Adapter、M5-B2 集成和测试实现。
- 从 actual files 排除初始化前 dirty 的 structure manifest、DESIGN 和 PLAN。
- 修复 Delivery Runtime 对 `.harness/tmp/` 嵌套临时 Git 仓库目录的解析。
- 新增真实嵌套 Git 仓库回归测试，RED 复现路径错误，GREEN 后原有交付回执测试通过。

## 边界

文档和知识同步继续保留在工作区并在交付报告中如实列出，不修改历史 baseline。
未执行 Git 暂存、提交、推送、发布或部署。
