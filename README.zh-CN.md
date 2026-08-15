# pi-ds-anchored-standard

[English](README.md)

这是一个专门面向 **DeepSeek V4 Pro 0813** 的 Pi workaround（变通方案）。项目目标是通过刻意精简第一次请求的工作环境，改善该模型的表现；从后续请求开始，Pi 恢复正常行为。

方法灵感来自
[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard)，
并通过 Pi 的扩展 API 在本项目中实现。

> **适用模型：** 只有当前模型是 DeepSeek V4 Pro 时，本扩展才会启用首轮精简。其他模型从第一次请求开始就保持普通 Pi 行为。

## 它改变了什么

### 只精简第一次请求

空白会话使用 DeepSeek V4 Pro，并第一次向模型 API 发起请求时，模型只能看到：

| 请求内容 | 值 |
|---|---|
| 系统提示词 | `You are a helpful software engineer assistant.` |
| 可用工具 | `bash` 和 `read` |
| 最大输出 | 1,024 tokens |
| 对话内容 | 系统提示词和当前用户消息 |

“可用工具”是指发送给模型的函数定义，也就是模型知道自己可以调用哪些操作。正常情况下，Pi 会把所有已启用的内置工具，以及其他扩展注册的工具都展示给模型；本扩展在第一次请求中只展示 `bash` 和 `read`。

第一次请求也不会包含 Pi 自动生成的操作说明、工作区上下文、AGENTS.md/CLAUDE.md 内容、技能目录，以及其他扩展追加的提示词。

模型检查接受以下 Pi model ID：`deepseek-v4-pro`、`deepseek-v4-pro-0813`、`deepseek/deepseek-v4-pro` 和 `deepseek/deepseek-v4-pro-0813`。当前模型不匹配这些 ID 时，本扩展不会修改提示词、上下文、工具或输出上限。

### 第一次工具调用或回复之后

模型第一次调用工具，或者完成第一次回复后，本扩展会让会话恢复为普通 Pi：

- 所有当前已启用的 Pi 工具重新可用；
- Pi 的正常系统提示词和工作区上下文恢复；
- 其他扩展追加的提示词恢复；
- 模型恢复正常的最大输出上限。

本项目把这个切换称为 **promotion（提升）**。默认配置下，第一次工具调用和第一次完整回复都可以触发提升。

如果第一次回复用完 1,024 tokens，Pi 通常会以 `stopReason: "length"` 停止。本扩展会先提升会话，再发送一条隐藏指令，让模型在同一次 agent 运行中继续。这样既保留了已经进行到一半的工作，也能使用恢复后的 Pi 提示词、工具和输出上限。

## 实现方式

核心逻辑位于 [`src/phases.ts`](src/phases.ts)：

1. 每个事件都会检查当前 model ID。非目标模型直接保留全部已启用工具和未经修改的请求。
2. `session_start` 和 `before_agent_start` 检查已保存的对话。DeepSeek V4 Pro 会话中只要已有 assistant 回复或工具结果，就视为已经提升。
3. 第一次调用模型之前，`before_agent_start` 保存 Pi 的正常系统提示词，并暂时只启用 `bash` 和 `read`。
4. `before_provider_request` 重写最终发送给模型 API 的第一次请求，确保提示词、消息、工具定义和 1,024-token 上限完全符合预期。
5. `tool_call` 和 `message_end` 检测第一次提升事件，并恢复首轮精简前的准确工具列表。
6. 如果第一次回复被 token 上限截断，`message_end` 会通过 Pi 的 `deliverAs: "steer"` 模式，在同一次运行中继续一次。

本扩展不单独保存阶段文件，也不写入额外数据库。已保存的对话就是状态来源，因此恢复、分叉或重新加载会话时，行为仍然正确。如果 `bash` 或 `read` 不可用，扩展会保持 Pi 当前工具列表不变，而不会应用残缺的首轮配置。

## 安装

```sh
pi install /path/to/pi-ds-anchored-standard
```

重启 Pi，或者执行 `/reload`。只想临时运行一次时：

```sh
pi -e ./src/index.ts
```

## 配置

包入口使用以下默认配置：

```ts
createAnchoredStandard({
  bootstrapTools: ["bash", "read"],
  bootstrapMaxTokens: 1024,
  promoteOn: "either",
  minimalPrompt: ANCHORED_MINIMAL_PROMPT,
});
```

`promoteOn` 还支持：

- `"tool-call"`：只在模型第一次调用工具后恢复普通 Pi；
- `"assistant-message"`：只在模型完成第一次回复后恢复普通 Pi。

只有在你明确希望第一次请求也保留 Pi 正常提示词和上下文时，才应把 `minimalPrompt` 设为 `null`。这些配置只会改变 DeepSeek V4 Pro 的首轮行为，不会为其他模型启用本 workaround。

## 可视化验证

我们使用同一个“生成鹈鹕骑自行车的动画 HTML”任务，在 `high` 和 `max` 两种思考级别下进行了六次运行。比较包含三种明确的设置：

1. **普通 Pi（未启用本扩展）**：模型从第一次请求开始就能看到 Pi 的正常提示词、工作区上下文和所有已启用工具。这是对照组，用来展示不启用本扩展时 Pi 的表现。
2. **新建后续轮次（早期方案）**：本扩展会精简第一次请求，但回复被截断后，会新建一个后续轮次。这个早期实现丢失了模型正在进行的推理状态。
3. **在同一次运行中继续（当前方案）**：本扩展精简第一次请求；回复被截断后，在同一次 agent 运行中继续，并恢复普通 Pi 的环境。

<table>
<thead><tr><th></th><th>High</th><th>Max</th></tr></thead>
<tbody>
<tr>
<th>普通 Pi<br>（未启用本扩展）</th>
<td><img src="validation/animated-html/animations/control-high.gif" alt="普通 Pi，high 思考级别" width="360"></td>
<td><img src="validation/animated-html/animations/control-max.gif" alt="普通 Pi，max 思考级别" width="360"></td>
</tr>
<tr>
<th>新建后续轮次<br>（早期方案）</th>
<td><img src="validation/animated-html/animations/followup-high.gif" alt="新建后续轮次，high 思考级别" width="360"></td>
<td><img src="validation/animated-html/animations/followup-max.gif" alt="新建后续轮次，max 思考级别，空白输出" width="360"></td>
</tr>
<tr>
<th>在同一次运行中继续<br>（当前方案）</th>
<td><img src="validation/animated-html/animations/steer-high.gif" alt="同一次运行内继续，high 思考级别" width="360"></td>
<td><img src="validation/animated-html/animations/steer-max.gif" alt="同一次运行内继续，max 思考级别" width="360"></td>
</tr>
</tbody>
</table>

这些动画来自仓库中实际 HTML 文件的浏览器录制。被测试的 agent 没有自行预览或验证输出。`max` 思考级别下，早期“新建后续轮次”方案生成的 SVG 布局大小为 `0×0`，所以录制结果是空白的；当前方案的两次输出都能正常渲染。与普通 Pi 对照组相比，当前方案的结果在这个测试中明显更丰富、更连贯，尤其是 `max` 结果加入了更清晰的骑行姿势、头盔、鱼、自行车结构和场景细节。这说明本 workaround 在该可视化测试中确实带来了改善，但不代表所有任务都会获得同样收益。

[验证目录](validation/animated-html/)保存了六个 HTML 文件、截图、动画、完整且已脱敏的 Pi 对话、脱敏脚本和 SHA-256 清单。

## 轨迹统计命令

`/trajectory` 会报告词频和回复形态统计：`let me`、`we`、`let's` 的出现次数，可见回复数，reasoning block 数量，以及 reasoning 长度中位数。该功能的灵感来自
[`xiaobright/modeltest` 的 DeepSeek V4 轨迹分析](https://github.com/xiaobright/modeltest/blob/main/docs/v4.1/DEEPSEEK_V4_TRAJECTORY_ANALYSIS_20260814.md)。
当前模型不是 DeepSeek V4 Pro 时，该命令不会启用。

这些统计只能作为线索，不能证明扩展一定成功或失败。该指纹来自结构化工程任务，在上面的创意动画任务中并不能稳定复现。

## 验证代码

```sh
npm install
npm test
npm run typecheck
```

测试覆盖模型限制、第一次请求塑形、会话状态判断、工具恢复、提示词恢复、首轮工具缺失、截断回复续写，以及轨迹统计。

## 注意事项

- `pi.setActiveTools()` 会影响当前 Pi 进程，因此扩展会在每次用户请求前检查当前会话，并重新应用正确的工具列表。
- 第一次工具调用即使被阻止或执行失败，也会触发提升。
- 精简提示词只用于第一次请求；提升后会恢复之前保存的 Pi 正常提示词。

## 许可证

MIT
