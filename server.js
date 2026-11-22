"use strict";

require("dotenv").config();

const path = require("path");
const express = require("express");
const db = require("./db");
const ai = require("./ai");

const PORT = Number(process.env.PORT || 7000);

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, unread: await db.countUnread() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    res.json(await db.getProjects());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_load_projects" });
  }
});

app.put("/api/projects", async (req, res) => {
  try {
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ error: "expected_array" });
    }
    await db.saveProjects(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_save_projects" });
  }
});

app.patch("/api/projects/:id/details", async (req, res) => {
  try {
    const details = String(req.body?.details ?? "");
    const ok = await db.updateProjectDetails(req.params.id, details);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_save_details" });
  }
});

app.get("/api/journals", async (_req, res) => {
  try {
    res.json(await db.getJournals());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_load_journals" });
  }
});

app.put("/api/journals", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "expected_object" });
    }
    await db.saveJournals(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_save_journals" });
  }
});

app.delete("/api/journals/:date", async (req, res) => {
  try {
    await db.deleteJournal(req.params.date);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_delete_journal" });
  }
});

app.get("/api/messages", async (_req, res) => {
  try {
    const messages = await db.getMessages();
    res.json({ messages, unread: await db.countUnread() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_load_messages" });
  }
});

app.delete("/api/messages/chat", async (_req, res) => {
  try {
    await db.clearChatMessages();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_clear_chat" });
  }
});

app.post("/api/messages/:id/read", async (req, res) => {
  try {
    await db.markMessageRead(req.params.id);
    res.json({ ok: true, unread: await db.countUnread() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed_to_mark_read" });
  }
});

app.post("/api/messages/chat", async (req, res) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "empty_content" });

    const enriched = await ai.enrichUserPrompt(content);
    const userMsg = await db.insertMessage("user", content, { kind: "chat" });
    const history = await db.getRecentChatContext(30);

    const messages = [
      {
        role: "system",
        content:
          "你是 Daily 0.1 的助手，帮助用户整理项目进度、今日学习、后续精进与思考。回答简洁、具体、可执行。" +
          (enriched.systemExtra ? `\n${enriched.systemExtra}` : ""),
      },
      ...history.slice(0, -1),
      { role: "user", content: enriched.userContent },
    ];

    const reply = await ai.chatCompletions(messages, 0.6);
    const assistantMsg = await db.insertMessage("assistant", reply || "（无回复）", {
      kind: "chat",
    });

    res.json({ user: userMsg, assistant: assistantMsg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "chat_failed", detail: String(err.message || err) });
  }
});

app.use(express.static(path.join(__dirname), { index: "index.html" }));

async function start() {
  await db.ping();
  await db.ensureSchema();
  await db.cleanupOldMessages();
  await ai.maybeRunJobs();

  setInterval(() => {
    db.cleanupOldMessages().catch((err) => console.error("cleanup messages:", err));
  }, 60 * 60 * 1000);

  setInterval(() => {
    ai.maybeRunJobs().catch((err) => console.error("jobs:", err));
  }, 30 * 60 * 1000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Daily 0.1 listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
