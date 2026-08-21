# FrontierScan Harness M8-A 完成后勘误

> 日期：2026-08-21
>
> 适用 Story：`M8-A-001`
>
> 类型：完成态外独立更正记录

## 勘误内容

已绑定的交付报告和 delivery result 摘要将 owned 文件数量写为 38，正确数量为 37。

权威机器事实：

```text
State delivery.ownedFiles.length=37
owned-manifest entries.length=37
outOfPredictionFiles.length=5
unrelatedDirtyFiles.length=1
```

权威文件：

```text
.harness/states/e2e-M8-A-001.json
.harness/runs/M8-A-001/delivery/owned-manifest.json
```

Manifest：

```text
sha256:4f9459afac7613696e577e4899b736a4b9ce459322c88032458bcd9d4e691b4c
```

在完成态冻结事实中，`docs/harness-m8a-review-provider/PLAN.md` 是唯一
`unrelatedDirtyFiles` 条目，不在上述 37 个 owned 文件中。本勘误是在完成后新增的独立
更正文件，因此当前工作区的只读 delivery summary 会把 `ERRATA.md` 作为第二个 unrelated
文件披露。

## 处理说明

`M8-A-001` 已是 `done/completed` revision `51`。按照完成态不可变规则，不修改 State、
已应用 result、已绑定交付报告或 manifest。本文件只更正人类可读数量，不改变交付文件集合、
哈希、验收结论或 Git 状态。

执行暂存或提交时必须以 State 的 `delivery.ownedFiles` 和 owned manifest 为准，不得使用
旧摘要中的 38 作为文件数量。
