# M7-D-001 接口与界面验证报告

## 验证环境

- 日期：2026-08-18
- 后端：`http://127.0.0.1:8080`
- 前端：`http://127.0.0.1:5174`
- 浏览器：通过 Chrome 扩展控制真实浏览器会话
- PostgreSQL：本地 Docker 容器中的独立 `frontierscan` 数据库
- Redis：本地 Docker 容器
- 数据基线：全部 217 篇、未读 216 篇、已读 1 篇

## 必需用例

| 用例 | 验收标准 | 操作 | 实际结果 | 状态 |
| --- | --- | --- | --- | --- |
| `VC-READ-UNREAD` | `AC-READ-FILTER-1` | 调用 `readStatus=unread` 并在 UI 选择未读 | API 和 UI 均返回 216 篇未读文章；当前页文章均为未读 | verified |
| `VC-READ-READ` | `AC-READ-FILTER-2` | 调用 `readStatus=read` 并在 UI 选择已读 | API 和 UI 均返回 1 篇已读文章；当前页文章显示已读 | verified |
| `VC-READ-COMBINED` | `AC-READ-FILTER-3` | API 组合分类、网站、关键词和分页；UI 组合未读、关键词和标签 | 两种组合均返回唯一匹配文章，页码和总数一致 | verified |
| `VC-READ-VALIDATION-ISOLATION` | `AC-READ-FILTER-4` | 发送非法 `readStatus` 并核对当前用户结果 | 非法参数返回 HTTP 400；查询结果未泄露其他用户文章 | verified |
| `VC-READ-UI-FILTER-PAGE` | `AC-READ-FILTER-1/2/5` | 未读列表进入第 2 页后切换已读，再切换全部 | 每次切换都回到第 1 页；结果依次为 216、1、217 篇 | verified |
| `VC-READ-UI-ROUNDTRIP` | `AC-READ-FILTER-1/2/5` | 在未读筛选中打开文章自动已读，再在详情中标记未读 | 自动已读后总数 216→215 且文章退出；恢复未读后总数 215→216 且文章重新出现 | verified |

## 验收中发现并关闭的问题

真实 UI 首轮执行发现：文章因自动已读退出未读列表后，再手动恢复未读时，详情状态更新但列表没有重新加载。根因是旧实现只处理当前卡片变得不匹配的情况，无法处理已退出列表的文章重新匹配。

修复采用 TDD：

1. 回归测试先证明缺席文章重新匹配时旧规则错误返回 `false`。
2. 活动 `read/unread` 筛选下，每次成功阅读状态变更都重新加载列表。
3. 新请求递增 `articleRequestId`，在途旧响应不能覆盖最新结果。
4. Node 回归测试 2 项通过，`npm run build` 通过。
5. 独立只读 Agent 复审最终无 `BLOCKER/WARNING`。

## 可选观察

在 `390×844` 视口下，既有 `app-shell/sidebar` 布局产生约 619px 的页面宽度和横向滚动。该问题来自全局布局的网格最小内容宽度，不是本 Story 新增阅读筛选控件造成，也不对应本 Story 的必需验收标准，因此本次不扩展修改范围。阅读筛选控件本身未发现文字或按钮重叠。

## 数据恢复

验收结束后，测试文章已恢复为未读，页面恢复为全部筛选：

```text
all=217
unread=216
read=1
selectedFilter=all
```

## 证据

- `attempts/ef96b257-03d9-42b0-a10e-b690dbe34428/evidence/api-verification.json`
- `attempts/ef96b257-03d9-42b0-a10e-b690dbe34428/evidence/browser-ui-verification.json`
- `attempts/ef96b257-03d9-42b0-a10e-b690dbe34428/evidence/frontend-regression.json`
- `attempts/ef96b257-03d9-42b0-a10e-b690dbe34428/evidence/final-review.json`

## 结论

五项必需验收标准均获得真实 API 或真实 Chrome UI 结论，浏览器运行时阻塞已经解除，验收期间发现的列表回归已修复并复验。`interface-verification` 可以完成并进入 `delivery-preparation`。
