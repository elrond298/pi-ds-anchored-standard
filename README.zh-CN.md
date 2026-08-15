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
| 可用工具 | Minimal 的 `bash` 和 `str_replace_editor` schema |
| 最大输出 | provider 默认值（首轮不封顶） |
| 对话内容 | 系统提示词和当前用户消息 |

“可用工具”是指发送给模型的函数定义，也就是模型知道自己可以调用哪些操作。正常情况下，Pi 会展示所有已启用工具；本扩展在第一次请求中只展示 Minimal 的 `bash` + `str_replace_editor` 工具对。它为 Pi 注册可用的 UTF-8 `str_replace_editor`，并把首轮的 `bash` 定义改写为 Minimal schema。

第一次请求也不会包含 Pi 自动生成的操作说明、工作区上下文、AGENTS.md/CLAUDE.md 内容、技能目录，以及其他扩展追加的提示词。

当前模型的 ID 或显示名称只要包含 `deepseek-v4-pro`（不区分大小写），本扩展就会启用。否则不会修改提示词、上下文、工具或输出上限。

### 第一次工具调用或回复之后

模型第一次调用工具，或者完成第一次回复后，本扩展会让会话恢复为普通 Pi：

- 所有当前已启用的 Pi 工具重新可用；
- Pi 的正常系统提示词和工作区上下文恢复；
- 其他扩展追加的提示词恢复；
- 模型恢复正常的最大输出上限。

本项目把这个切换称为 **promotion（提升）**。默认配置下，第一次工具调用和第一次完整回复都可以触发提升。实时 bootstrap 完成时，Pi 会显示一次信息通知。

如果第一次回复达到 provider 的输出上限，Pi 通常会以 `stopReason: "length"` 停止。本扩展会先提升会话，再发送一条隐藏指令，让模型在同一次 agent 运行中继续，并使用恢复后的 Pi 提示词和工具。

## 实现方式

核心逻辑位于 [`src/phases.ts`](src/phases.ts)：

1. 每个事件都会检查当前 model ID 或显示名称是否包含 `deepseek-v4-pro`。非目标模型保留原有工具和未经修改的请求。
2. `session_start` 和 `before_agent_start` 检查已保存的对话。DeepSeek V4 Pro 会话中只要已有 assistant 回复或工具结果，就视为已经提升。
3. 第一次调用模型之前，`before_agent_start` 保存 Pi 的正常系统提示词，并暂时只启用 `bash` 和 `str_replace_editor`。
4. `before_provider_request` 重写第一次请求的提示词、消息和工具定义，使其与 Minimal 对齐，同时保留 provider 的输出预算。
5. `tool_call` 和 `message_end` 检测第一次提升事件，并恢复首轮精简前的准确工具列表。
6. 如果第一次回复被 token 上限截断，`message_end` 会通过 Pi 的 `deliverAs: "steer"` 模式，在同一次运行中继续一次。

本扩展不单独保存阶段文件，也不写入额外数据库。已保存的对话就是状态来源，因此恢复、分叉或重新加载会话时，行为仍然正确。如果任一 bootstrap 工具不可用，扩展会保持 Pi 当前工具列表不变，而不会应用残缺的首轮配置。

## 安装

```sh
pi install git:github.com/elrond298/pi-ds-anchored-standard
```
本地检出可使用 `pi install /path/to/pi-ds-anchored-standard`。

重启 Pi，或者执行 `/reload`。只想临时运行一次时：

```sh
pi -e ./src/index.ts
```

## 配置

包入口使用以下默认配置：

```ts
createAnchoredStandard({
  bootstrapTools: ["bash", "str_replace_editor"],
  promoteOn: "either",
  minimalPrompt: ANCHORED_MINIMAL_PROMPT,
});
```
`bootstrapMaxTokens` 默认不设置，因此沿用 provider 的正常输出预算。只有需要首轮封顶时，才把它设为正整数。

`promoteOn` 还支持：

- `"tool-call"`：只在模型第一次调用工具后恢复普通 Pi；
- `"assistant-message"`：只在模型完成第一次回复后恢复普通 Pi。

只有在你明确希望第一次请求也保留 Pi 正常提示词和上下文时，才应把 `minimalPrompt` 设为 `null`。这些配置只会改变 DeepSeek V4 Pro 的首轮行为，不会为其他模型启用本 workaround。

## 可视化验证

我们使用同一个“生成鹈鹕骑自行车的动画 HTML”任务，在 `high` 和 `max` 两种思考级别下进行了八次运行，比较四种设置：

1. **普通 Pi（未启用本扩展）**：模型从第一次请求开始就能看到 Pi 的正常提示词、工作区上下文和所有已启用工具。这是对照组，用来展示不启用本扩展时 Pi 的表现。
2. **新建后续轮次（早期方案）**：本扩展会精简第一次请求，但回复被截断后，会新建一个后续轮次。这个早期实现丢失了模型正在进行的推理状态。
3. **1,024-token 同轮续写（旧默认值）**：首轮截断后在同一次 agent 运行中继续，并恢复普通 Pi。
4. **30,000-token 实验**：旧版 `bash` + `read` 实现把 `bootstrapMaxTokens` 设为 30,000。

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
<td><img src="validation/animated-html/animations/followup-max.gif" alt="新建后续轮次，max 思考级别" width="360"></td>
</tr>
<tr>
<th>1,024-token 同轮续写<br>（旧默认值）</th>
<td><img src="validation/animated-html/animations/steer-high.gif" alt="同一次运行内继续，high 思考级别" width="360"></td>
<td><img src="validation/animated-html/animations/steer-max.gif" alt="同一次运行内继续，max 思考级别" width="360"></td>
</tr>
<tr>
<th>30,000-token 实验</th>
<td><img src="validation/animated-html/animations/bootstrap-30k-high.gif" alt="30,000-token 首轮，high 思考级别" width="360"></td>
<td><img src="validation/animated-html/animations/bootstrap-30k-max.gif" alt="30,000-token 首轮，max 思考级别" width="360"></td>
</tr>
</tbody>
</table>
这些归档运行使用旧版 `bash` + `read` bootstrap，并比较其 1,024-token 默认值与 30,000-token 封顶；当前不封顶的 Minimal 工具对尚未包含在动画中。

提高首轮 token 上限没有稳定改善表现：`high` 更慢且视觉效果更差；`max` 的画面更干净，但耗时从 291.5 秒增加到 850.8 秒。这里只展示一个可视化示例，不代表一般结论。

[验证目录](validation/animated-html/)保存了八个 HTML 文件、截图、动画、完整且已脱敏的 Pi 对话、脱敏脚本和 SHA-256 清单。

## 轨迹统计命令

`/trajectory` 会报告词频和回复形态统计：`let me`、`we`、`let's`、`I'll` / `I will`、`We'll` / `We will` 的出现次数，可见回复数，reasoning block 数量，以及 reasoning 长度中位数。该功能的灵感来自
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
