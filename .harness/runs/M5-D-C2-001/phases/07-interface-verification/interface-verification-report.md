# M5-D-C2 接口验证报告

## 结论

Harness 内部接口验证通过；业务 API 与 UI 验证不适用。

## 覆盖

- freeze/recover-freeze 输入哈希与 owner 门禁。
- integrate/recover-integration 确认参数、稳定顺序、前缀恢复和漂移拒绝。
- `finalize-wave` PowerShell/Node 参数边界与正式 phase 绑定。
- M3 `apply` 单次推进、重复调用和推进前后中断恢复。
