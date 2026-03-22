# AI工具使用指南

面向各行各业普通人的 AI 工具学习平台。精选 14 款实用 AI 工具，涵盖 27 个职业方向，帮助你从零上手 AI，提升工作效率。

## 功能

- **AI工具库** — 14 款精选工具（DeepSeek、Kimi、Claude、Midjourney、Cursor 等），免费为主
- **实战练习** — 5 个场景练习（写邮件、分析合同、做PPT大纲、写文案等）
- **学习文章** — 5 篇深度指南（提示词技巧、农民/上班族/学生/小企业主专题）
- **职业推荐** — 27 个职业的个性化 AI 工具推荐路径

## 技术栈

- Next.js 14 (App Router，静态导出) + React 18 + TailwindCSS + TypeScript
- 部署：GitHub Pages（push 到 `main` 分支自动触发）

## 快速开始

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # 静态构建，输出到 out/
```

## 项目结构

```
src/
├── app/
│   ├── page.tsx        # 首页
│   ├── tools/          # AI工具库
│   ├── practices/      # 实战练习
│   ├── docs/           # 学习文章
│   └── onboarding/     # 职业推荐
├── components/Nav.tsx
└── data/               # tools.json / docs.json / practices.json / professions.json
```
