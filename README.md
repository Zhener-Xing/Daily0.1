# Daily 0.1

项目进度 + Today's 0.1 + DeepSeek AI 对话。

## 环境变量

复制 `.env.example` 为 `.env`，填入 DeepSeek API Key 与 MySQL 配置。

## 本地运行

```bash
npm install
# 先按 schema.sql 建库建表
npm start
```

打开 http://127.0.0.1:7000/

## 数据

MySQL 库 `daily01`：

- `projects` — 项目 / 子项目
- `journals` — Today's 0.1
- `messages` — AI 对话（超过 30 天自动清除）
