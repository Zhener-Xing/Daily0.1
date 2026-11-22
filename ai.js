"use strict";

const db = require("./db");

const DEEPSEEK_API_KEY = () => process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_BASE = () =>
  (process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com").replace(/\/$/, "");
const DEEPSEEK_MODEL = () => process.env.DEEPSEEK_MODEL || "deepseek-chat";

async function chatCompletions(messages, temperature = 0.5) {
  const key = DEEPSEEK_API_KEY();
  if (!key) throw new Error("missing_deepseek_api_key");

  const aiRes = await fetch(`${DEEPSEEK_API_BASE()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL(),
      messages,
      temperature,
    }),
  });

  if (!aiRes.ok) {
    const text = await aiRes.text();
    throw new Error(`deepseek_failed:${aiRes.status}:${text.slice(0, 400)}`);
  }

  const data = await aiRes.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoKey(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return dateKey(d);
}

function flattenProjects(tree, trail = []) {
  /** @type {{ id: string, name: string, path: string, completed: boolean, archived: boolean, details: string, progress: string, childrenCount: number }[]} */
  const out = [];
  for (const n of tree || []) {
    const path = [...trail, n.name];
    out.push({
      id: n.id,
      name: n.name,
      path: path.join(" / "),
      completed: !!n.completed,
      archived: !!n.archived,
      details: n.details || "",
      progress: n.progress || "",
      childrenCount: Array.isArray(n.children) ? n.children.length : 0,
    });
    if (n.children?.length) out.push(...flattenProjects(n.children, path));
  }
  return out;
}

function filterJournalsByDays(journals, days) {
  const from = daysAgoKey(days - 1);
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(journals || {})) {
    if (k >= from) out[k] = v;
  }
  return out;
}

function journalsHaveContent(entry) {
  if (!entry) return false;
  if (String(entry.thoughts || "").trim()) return true;
  for (const list of [entry.learning, entry.improve]) {
    if (Array.isArray(list) && list.some((i) => String(i?.text || "").trim())) return true;
  }
  return false;
}

async function buildWorkspaceContext({ journalDays = 30 } = {}) {
  const [projects, journals] = await Promise.all([db.getProjects(), db.getJournals()]);
  const flat = flattenProjects(projects);
  const recentJournals = filterJournalsByDays(journals, journalDays);
  const openProjects = flat.filter((p) => !p.completed && !p.archived);
  const improveItems = [];
  for (const [date, entry] of Object.entries(journals || {})) {
    for (const item of entry.improve || []) {
      if (!String(item.text || "").trim()) continue;
      const linked = flat.find((p) => p.id === item.projectId);
      improveItems.push({
        date,
        text: item.text,
        projectPath: linked ? linked.path : null,
      });
    }
  }
  return { projects, flat, journals, recentJournals, openProjects, improveItems };
}

function detectPreset(content) {
  const t = String(content || "").trim();
  if (t === "给我讲讲我最近的进展" || t.includes("最近的进展")) return "progress";
  if (t === "最近还有什么任务？" || t.includes("还有什么任务")) return "tasks";
  return null;
}

async function enrichUserPrompt(content) {
  const preset = detectPreset(content);
  const ctx = await buildWorkspaceContext({ journalDays: preset === "tasks" ? 90 : 30 });

  if (preset === "progress") {
    return {
      preset,
      systemExtra:
        "用户要你总结近一个月所有 Today's 0.1，说明学到了什么、各项目推进如何。基于数据回答，条理清晰，可分点。",
      userContent: `请根据以下数据回答：「给我讲讲我最近的进展」

【近 30 天 Today's 0.1】
${JSON.stringify(ctx.recentJournals, null, 2)}

【项目列表】
${JSON.stringify(
  ctx.flat.map((p) => ({
    id: p.id,
    path: p.path,
    completed: p.completed,
    archived: p.archived,
    progress: p.progress,
  })),
  null,
  2
)}`,
    };
  }

  if (preset === "tasks") {
    return {
      preset,
      systemExtra:
        "用户要你总结所有未完成的项目/子项目，以及 Today's 0.1 里「后续精进」条目。列出待办清单，便于行动。",
      userContent: `请根据以下数据回答：「最近还有什么任务？」

【未完成项目/子项目】
${JSON.stringify(
  ctx.openProjects.map((p) => ({ id: p.id, path: p.path, details: p.details })),
  null,
  2
)}

【后续精进条目】
${JSON.stringify(ctx.improveItems, null, 2)}`,
    };
  }

  return {
    preset: null,
    systemExtra: "",
    userContent: content,
  };
}

async function runThreeDayProgressJob() {
  const ctx = await buildWorkspaceContext({ journalDays: 3 });
  const recent = Object.fromEntries(
    Object.entries(ctx.recentJournals).filter(([, e]) => journalsHaveContent(e))
  );
  if (!Object.keys(recent).length) {
    await db.setMeta("last_progress_job", new Date().toISOString());
    return { ok: true, skipped: "no_journals" };
  }

  const prompt = `你是项目助理。请根据近 3 天的 Today's 0.1，为相关项目更新「目前进度」。
只输出 JSON（不要 markdown 代码块），格式：
{"updates":[{"projectId":"项目或子项目id","summary":"该项目这三天的进展摘要（2-6句）"}]}

规则：
- projectId 必须来自下方项目列表
- 若某条学习/精进关联了项目，优先更新该项目
- 也可更新明显相关的上级项目
- 没有进展的项目不要编造

【近 3 天 Today's 0.1】
${JSON.stringify(recent, null, 2)}

【项目列表】
${JSON.stringify(
  ctx.flat.filter((p) => !p.archived).map((p) => ({ id: p.id, path: p.path, completed: p.completed })),
  null,
  2
)}`;

  const raw = await chatCompletions(
    [
      { role: "system", content: "你只输出合法 JSON 对象，不要额外文字。" },
      { role: "user", content: prompt },
    ],
    0.3
  );

  let parsed;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("progress job JSON parse failed:", raw.slice(0, 500));
    return { ok: false, error: "bad_json" };
  }

  const stamp = dateKey();
  let count = 0;
  for (const u of parsed.updates || []) {
    if (!u?.projectId || !u?.summary) continue;
    const exists = ctx.flat.some((p) => p.id === u.projectId);
    if (!exists) continue;
    const block = `【${stamp} 自动整理】\n${String(u.summary).trim()}`;
    await db.appendProjectProgress(u.projectId, block);
    count += 1;
  }

  await db.setMeta("last_progress_job", new Date().toISOString());
  return { ok: true, updated: count };
}

async function runWeeklyReportJob() {
  const ctx = await buildWorkspaceContext({ journalDays: 7 });
  const recent = Object.fromEntries(
    Object.entries(ctx.recentJournals).filter(([, e]) => journalsHaveContent(e))
  );

  const prompt = `请写一份本周周报，基于数据，结构清晰，使用中文。必须包含：
1. 本周学习内容
2. 项目进度
3. 待精进内容
4. 思考摘要
5. 「学习填补精进」：指出本周完成的学习中，哪些回应/填补了先前（含本周前）的后续精进条目；若没有则说明暂无明显对应

【近 7 天 Today's 0.1】
${JSON.stringify(recent, null, 2)}

【项目与目前进度】
${JSON.stringify(
  ctx.flat
    .filter((p) => !p.archived)
    .map((p) => ({
      id: p.id,
      path: p.path,
      completed: p.completed,
      progress: p.progress,
    })),
  null,
  2
)}

【历史后续精进（供对照）】
${JSON.stringify(ctx.improveItems, null, 2)}`;

  const report = await chatCompletions(
    [
      {
        role: "system",
        content: "你是 Daily 0.1 周报助手，输出可读的中文周报正文，不要包 JSON。",
      },
      { role: "user", content: prompt },
    ],
    0.5
  );

  const title = `周报 · ${daysAgoKey(6)} ~ ${dateKey()}`;
  const msg = await db.insertMessage("assistant", report || "（本周暂无足够数据生成周报）", {
    kind: "weekly",
    title,
    unread: true,
  });

  await db.setMeta("last_weekly_job", new Date().toISOString());
  return { ok: true, messageId: msg.id };
}

async function maybeRunJobs() {
  const now = Date.now();
  const lastProgress = await db.getMeta("last_progress_job");
  const lastWeekly = await db.getMeta("last_weekly_job");

  if (!lastProgress) {
    await db.setMeta("last_progress_job", new Date().toISOString());
  } else if (now - new Date(lastProgress).getTime() >= 3 * 24 * 60 * 60 * 1000) {
    try {
      console.log("[job] three-day progress", await runThreeDayProgressJob());
    } catch (err) {
      console.error("[job] three-day failed", err);
    }
  }

  if (!lastWeekly) {
    await db.setMeta("last_weekly_job", new Date().toISOString());
  } else if (now - new Date(lastWeekly).getTime() >= 7 * 24 * 60 * 60 * 1000) {
    try {
      console.log("[job] weekly report", await runWeeklyReportJob());
    } catch (err) {
      console.error("[job] weekly failed", err);
    }
  }
}

module.exports = {
  chatCompletions,
  enrichUserPrompt,
  runThreeDayProgressJob,
  runWeeklyReportJob,
  maybeRunJobs,
  detectPreset,
};
