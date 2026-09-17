# dsh-api-balance

在 DSH Desktop 的对话标题栏里实时显示 DeepSeek API 余额与本会话 token 用量。

A live DeepSeek API balance and per-session token usage chip in the DSH conversation header.

---

## 它做什么 / What it does

**标题栏按钮 / Header chip** — 出现在会话标题栏右侧（在「在应用中打开」「下载会话日志」旁边），形如：

```
● ¥88.99 · 12.3k tok
```

圆点颜色表示状态：绿＝余额可用，黄＝余额不足，红＝查询失败，灰＝正在取数。

**详情面板 / Detail panel** — 点按钮在右上角展开：

- **余额**：总额大字 + 可用状态，拆分为「充值余额 / 赠送余额」，并标注数据来源。
- **本会话用量**：模型路由、请求次数、输入 / 输出 / 缓存命中 / 合计 tokens。
- **上下文占用**：`263.4k / 1.0M (26%)` 加一条进度条。
- 「刷新」「关闭」，以及更新时间戳。

**刷新节奏** — 页面每 20 秒轮询一次，且只在会话界面打开时轮询；Host 侧余额结果另有 15 秒缓存，所以多开窗口不会放大请求。点击展开时会强制取一次最新值。

## 安装 / Install

```sh
dsh plugin --profile web add github:X-Xyy/dsh-api-balance
```

包内没有构建步骤（客户端半边是已产出的模块文件），也没有第三方运行时依赖。

重启（或刷新页面）后按钮即出现。

## 卸载 / Uninstall

```sh
dsh plugin --profile web remove dsh-api-balance
```

再删掉 profile 的 `cordis.patch.yml` 里对应的 `insert` 行即可。

## 它是怎么取数的 / How it reads data

- **余额**来自 `GET {baseURL}/user/balance`，接口地址与凭据名优先读 `settings` 的 `llm-deepseek` 段（`baseURL` / `apiKeyEnv`），否则回落到 `https://api.deepseek.com` 与 `DEEPSEEK_API_KEY`。
- **API key 在每次查询时**通过 `ctx.credentials` 现取，**不缓存、不落盘、不写入日志、不返回给浏览器**；本插件不使用任何 shell 或子进程，请求直接用 `node:http(s)` 发出。
- **用量**折叠自会话日志里 `assistant/message` 事件的 `usage` 字段（输入 / 输出 / 缓存命中 / 推理 tokens），上下文压力取自 `ctx.tokenMeter`。

## 隐私 / Privacy

浏览器半边通过本机回环地址上的一条路由取数：

```
GET /dsh-api-balance/snapshot?sessionId=<id>[&force=1]
```

该路由**不携带任何密钥**，只返回余额数字与 token 计数。请注意：它**不要求认证**，因此本机上的其它程序同样可以读到这些数字（读不到 API key）。如果你的回环地址不可信，请自行加一道校验或不要安装本插件。

## 兼容性 / Compatibility

- 平台：DSH Web / DSH Desktop（`dsh.client.platform: web`）。
- 无 `dependencies`，也不声明官方 `@deepseek-ai/*` 包依赖——只用模块加载器提供的 `react` 种子模块与宿主服务。

## 结构 / Layout

```
package.json         dsh.bundle（可安装）+ dsh.client（浏览器半边）
cordis.patch.yml     装载行：把插件插进 profile 的层栈
lib/index.js         宿主半边：/dsh-api-balance/snapshot 路由 + 余额/用量取值
client/client.js     浏览器半边：标题栏 chip + 详情面板（模块加载器格式）
```

## License

MIT
