#!/usr/bin/env node
/**
 * Triage agent for GitHub Discussions.
 *
 * Zero-dependency (Node >= 20, global fetch only). Reads the discussion via
 * the public REST API (token optional for reads), builds a context pack from
 * in-repo docs and code greps, asks an LLM to classify, then optionally
 * replies in the discussion and/or opens a linked issue.
 *
 * Environment:
 *   GITHUB_REPOSITORY       owner/name (set by Actions)
 *   GITHUB_TOKEN            token with discussions:write + issues:write (writes)
 *   INPUT_DISCUSSION_NUMBER re-run triage on this discussion (workflow_dispatch)
 *   LLM_API_KEY            required: OpenAI-compatible chat-completions key
 *   LLM_BASE_URL           optional: chat-completions endpoint override
 *   LLM_MODEL              optional: model id (default glm-5.3)
 *   DRY_RUN                 when set: classify + print plan, perform no writes
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.github.com';
const BOT_LOGIN = 'github-actions[bot]';
const MAX_REPLY_CHARS = 1500;
const DISCLAIMER = '> **AI triage assistant** — automated analysis; may be imperfect.';

/* ---------------------------------------------------------------- GitHub API */

async function gh(path, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'oleafly-discussion-triage',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

/* ------------------------------------------------------------- context pack */

const STOPWORDS = new Set(
  ('the a an and or but if then else for to of in on at by with from as is are was were be been being ' +
    'this that these those it its i me my we our you your they their he she them not no yes do does did ' +
    'have has had can could should would will just about into over under more most some any all when what ' +
    'how why where which who whom there here also very much please thanks thank hi hello hey so than too ' +
    'app application oleafly using use used get gets like want wants need needs new make makes made way ways')
    .split(' '),
);

function extractKeywords(text) {
  const freq = new Map();
  for (const raw of text.toLowerCase().split(/[^a-z0-9_-]+/)) {
    const t = raw.replace(/^[-_]+|[-_]+$/g, '');
    if (t.length < 4 || STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
}

function buildDocsIndex(keywords) {
  const dir = 'docs';
  if (!existsSync(dir)) return '(no docs directory found)';
  const lines = [];
  const scored = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const content = readFileSync(join(dir, f), 'utf8');
    const heading = (content.match(/^#\s+(.+)$/m) ?? [, '(untitled)'])[1].trim();
    lines.push(`- docs/${f} — ${heading}`);
    const lower = content.toLowerCase();
    const hits = keywords.filter((k) => lower.includes(k)).length;
    if (hits > 0) scored.push({ file: `docs/${f}`, hits, excerpt: content.slice(0, 600) });
  }
  scored.sort((a, b) => b.hits - a.hits);
  const relevant = scored
    .slice(0, 3)
    .map((s) => `\n### Possible match: ${s.file}\n<doc>\n${s.excerpt}\n</doc>`)
    .join('');
  return `Docs index:\n${lines.join('\n')}${relevant}`;
}

function grepCode(keywords) {
  if (keywords.length === 0) return '(no keywords)';
  const pattern = keywords.join('|');
  const dirs = ['src', 'packages', 'src-tauri', 'crates'].filter((d) => existsSync(d));
  if (dirs.length === 0) return '(no source dirs found)';
  const r = spawnSync(
    'grep',
    ['-rinE', '-m', '12', '--include=*.{ts,tsx,js,jsx,rs}', pattern, ...dirs],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.status !== 0 && !r.stdout) return `(no code matches for: ${pattern})`;
  const byFile = new Map();
  for (const line of r.stdout.split('\n')) {
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const file = line.slice(0, idx);
    if (!byFile.has(file)) byFile.set(file, []);
    if (byFile.get(file).length < 8) byFile.get(file).push(line.slice(idx + 1).trim());
  }
  let out = [...byFile.entries()]
    .slice(0, 10)
    .map(([file, lines]) => `${file}\n  ${lines.join('\n  ')}`)
    .join('\n');
  if (out.length > 30000) out = out.slice(0, 30000) + '\n(truncated)';
  return out;
}

/* ------------------------------------------------------------------ LLM call */

function provider() {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('No LLM provider configured: set the LLM_API_KEY secret');
  const url = process.env.LLM_BASE_URL?.trim() || 'https://api.z.ai/api/coding/paas/v4/chat/completions';
  const model = process.env.LLM_MODEL?.trim() || 'glm-5.3';
  return { url, key, model, name: `${new URL(url).host}:${model}` };
}

const SYSTEM_PROMPT = `You are the triage assistant for Oleafly — a local-first, cross-platform academic-writing app (LaTeX/Typst/Markdown) built with Tauri: TypeScript frontend in src/ and packages/, Rust backend in src-tauri/ and crates/.

Classify a GitHub Discussion and decide the single response action:

- "bug": The post reports concrete misbehavior — app bug, crash, data loss, export/compile failure, or an API/AI-assistant problem (errors calling AI providers, MCP, vision, completions). Use the code-search context to judge plausibility and to locate where it may originate. Write a focused technical analysis: what looks wrong, likely area of the codebase, what additional info would confirm it. Do NOT classify feature wishes as bugs.
- "docs_redirect": The post asks for something already covered by the project docs provided in context. Reply pointing to the exact doc files and briefly summarize what is there.
- "answer": A usage question not fully covered by docs. Answer concisely using only the docs/code context provided. If context is insufficient to answer confidently, choose "silence" instead.
- "silence": Feature ideas / brainstorming not already in docs (maintainers read those; do not reply), vague posts, spam, greetings, or anything uncertain. When in doubt, silence.

Rules:
- analysis_md: GitHub-flavored markdown, technical, no filler, max ~1200 chars.
- issue_title and issue_body_md: only meaningful for "bug". Title concise with area prefix, e.g. "[AI copilot] ...". Body = analysis + reproduction details from the post + "Reported in discussion" line.
- doc_links: repo-relative paths that exist in the provided docs index. Never invent paths.

Return ONLY a JSON object, no prose, no code fences:
{"action":"bug|docs_redirect|answer|silence","analysis_md":"...","issue_title":"...","issue_body_md":"...","doc_links":["docs/..."]}`;

async function classify(discussion, comments, docsIndex, codeHits) {
  const p = provider();
  const userMsg = [
    `Discussion #${discussion.number}: ${discussion.title}`,
    `Category: ${discussion.category?.name ?? 'n/a'} (${discussion.category?.slug ?? 'n/a'})`,
    `Author: ${discussion.user?.login ?? 'unknown'}`,
    '',
    'Body:',
    discussion.body ?? '(empty)',
    comments.length ? `\nExisting comments:\n${comments.map((c) => `- ${c.user?.login}: ${c.body?.slice(0, 500)}`).join('\n')}` : '',
    '',
    '<docs_context>',
    docsIndex,
    '</docs_context>',
    '',
    '<code_search>',
    codeHits,
    '</code_search>',
  ].join('\n');

  const call = async (messages) => {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
      body: JSON.stringify({ model: p.model, temperature: 0.2, max_tokens: 2000, messages }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM ${p.name} -> ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text).choices?.[0]?.message?.content ?? '';
  };

  let messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMsg },
  ];
  let raw = await call(messages);
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = extractJson(raw);
    if (parsed) return parsed;
    messages = [...messages, { role: 'assistant', content: raw }, { role: 'user', content: 'Return ONLY the JSON object, no prose, no fences.' }];
    raw = await call(messages);
  }
  return null;
}

function extractJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (!['bug', 'docs_redirect', 'answer', 'silence'].includes(obj.action)) return null;
    return obj;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- actions */

function similarity(a, b) {
  const tokens = (s) => new Set(a.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

async function findDuplicateIssue(repo, title) {
  const keywords = extractKeywords(title).slice(0, 6);
  if (keywords.length === 0) return null;
  const q = encodeURIComponent(`repo:${repo} is:issue is:open ${keywords.join(' ')}`);
  const data = await gh(`/search/issues?q=${q}&per_page=5`);
  let best = null;
  for (const item of data.items ?? []) {
    const score = similarity(title, item.title);
    if (!best || score > best.score) best = { score, item };
  }
  return best && best.score >= 0.5 ? best.item : null;
}

const postComment = (repo, number, body) =>
  gh(`/repos/${repo}/discussions/${number}/comments`, { method: 'POST', body: { body } });

const createIssue = (repo, title, body) =>
  gh(`/repos/${repo}/issues`, { method: 'POST', body: { title, body, labels: ['bug'] } });

/* ----------------------------------------------------------------------- main */

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY not set');

  let number = process.env.INPUT_DISCUSSION_NUMBER;
  if (!number && process.env.GITHUB_EVENT_PATH) {
    const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    number = ev.discussion?.number;
  }
  if (!number) throw new Error('No discussion number (INPUT_DISCUSSION_NUMBER or event payload)');

  const discussion = await gh(`/repos/${repo}/discussions/${number}`);
  const comments = await gh(`/repos/${repo}/discussions/${number}/comments?per_page=50`);

  if ((discussion.user?.login ?? '').endsWith('[bot]')) {
    console.log(`Author ${discussion.user.login} is a bot — skipping.`);
    return;
  }
  if (comments.some((c) => (c.user?.login ?? '') === BOT_LOGIN)) {
    console.log(`Discussion #${number} already triaged — skipping.`);
    return;
  }

  const keywords = extractKeywords(`${discussion.title}\n${discussion.body ?? ''}`);
  console.log(`Discussion #${number}: "${discussion.title}"`);
  console.log(`Keywords: ${keywords.join(', ')}`);

  const [docsIndex, codeHits] = [buildDocsIndex(keywords), grepCode(keywords)];
  const verdict = await classify(discussion, comments, docsIndex, codeHits);
  if (!verdict) {
    console.log('Could not parse a valid verdict from the LLM — staying silent.');
    return;
  }
  console.log(`Verdict (${provider().name}): ${JSON.stringify(verdict, null, 2)}`);
  if (process.env.DRY_RUN) {
    console.log('DRY_RUN set — no writes performed.');
    return;
  }

  const clip = (s) => (s ?? '').slice(0, MAX_REPLY_CHARS);

  if (verdict.action === 'silence') {
    console.log('Action: silence.');
    return;
  }

  if (verdict.action === 'bug') {
    const duplicate = await findDuplicateIssue(repo, verdict.issue_title || discussion.title);
    if (duplicate) {
      console.log(`Similar issue exists: #${duplicate.number} ${duplicate.title}`);
      await postComment(
        repo,
        number,
        `${DISCLAIMER}\n\n${clip(verdict.analysis_md)}\n\nThis looks related to existing issue #${duplicate.number} (${duplicate.html_url}) — tracking it there.`,
      );
      return;
    }
    const issueBody = [
      verdict.issue_body_md || verdict.analysis_md,
      '',
      '---',
      `Reported in discussion #${number}: ${discussion.html_url}`,
      `Discussion category: ${discussion.category?.name ?? 'n/a'}`,
      `Reporter: @${discussion.user?.login ?? 'unknown'}`,
    ].join('\n');
    const issue = await createIssue(repo, verdict.issue_title || discussion.title, issueBody);
    console.log(`Created issue #${issue.number}: ${issue.html_url}`);
    await postComment(
      repo,
      number,
      `${DISCLAIMER}\n\n${clip(verdict.analysis_md)}\n\nI've opened #${issue.number} (${issue.html_url}) so this gets tracked as a bug. Please add any missing details (logs, steps to reproduce) there.`,
    );
    return;
  }

  if (verdict.action === 'docs_redirect') {
    const links = (verdict.doc_links ?? [])
      .filter((l) => typeof l === 'string' && /^[\w./-]+\.md$/.test(l))
      .map((l) => `- [${l}](https://github.com/${repo}/blob/main/${l})`)
      .join('\n');
    await postComment(
      repo,
      number,
      `${DISCLAIMER}\n\n${clip(verdict.analysis_md)}${links ? `\n\nRelevant documentation:\n${links}` : ''}`,
    );
    console.log('Replied with docs redirect.');
    return;
  }

  // answer
  await postComment(repo, number, `${DISCLAIMER}\n\n${clip(verdict.analysis_md)}`);
  console.log('Replied with an answer.');
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
