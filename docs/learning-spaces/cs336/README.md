---
title: Stanford CS336 学习地图
summary: 用课程、作业和实验串起语言模型工程的完整训练路径。
status: published
order: 1
tags: [CS336, LLM training]
estimatedMinutes: 20
---

# Stanford CS336 学习地图

这个模块用于组织 CS336 的课程笔记、阅读材料、作业拆解和实验复盘。

## 建议路径

- 数据处理与 tokenizer。
- Transformer 结构与训练实现。
- 并行训练、显存和吞吐。
- Scaling law、评测和推理。
- 作业实现与失败记录。

```mermaid
flowchart LR
    Data[数据] --> Model[模型实现]
    Model --> Train[训练系统]
    Train --> Evaluate[评测]
    Evaluate --> Reflect[实验复盘]
```

> 顶层平台不抓取课程网页；所有外部资料都由本模块以链接和个人笔记的形式组织。
