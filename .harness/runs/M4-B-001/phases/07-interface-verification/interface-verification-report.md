# M4-B 内部接口验证报告

## 验证对象

```js
runWorkerTask({ root, taskFile, provider, timeoutMs, contextFiles })
```

以及 M3 `task.json/result.json` Schema `1.0` 文件协议。

## 结果

| 场景 | 结果 |
| --- | --- |
| 读取允许的显式 context 并向 provider 提供 task/policy/context/signal | 通过 |
| 策略漂移、越权读取、symlink、非 UTF-8、大小超限 | provider 调用前拒绝 |
| provider 异常或超时 | 无结果、revision 不变 |
| 非法身份、record、capability、路径、候选冲突和输出集合 | 落盘前拒绝 |
| 产物写入后中断 | result 不存在，相同 dispatch 重试成功 |
| `prepare -> Worker -> apply` | Worker 后 revision 不变，apply 后仅推进一次 |

## 环境说明

验证全部在临时单 Story fixture 和 Harness Smoke 中执行，不依赖真实模型、外部 API、浏览器、部署环境或业务数据。M4-B 没有用户界面或 HTTP API，因此不存在需要伪造的线上接口验证。
