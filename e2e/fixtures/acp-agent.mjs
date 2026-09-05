import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

if (process.argv.includes("--child")) {
  setInterval(() => {}, 1_000);
} else {
  const argument = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? null : process.argv[index + 1];
  };
  const pidFile = argument("--pid-file");
  const stateFile = argument("--state-file");
  let state = stateFile && existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf8"))
    : { authenticated: !process.argv.includes("--require-login"), modelId: "e2e-model-a" };
  let nativeId = `e2e-${randomUUID()}`;
  let projectRoot = process.cwd();
  let turn = 0;
  let pending = null;

  const saveState = () => {
    if (stateFile) writeFileSync(stateFile, JSON.stringify(state));
  };
  const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
  const result = (request, value) => send({ id: request.id, result: value });
  const update = (sessionUpdate, fields = {}) => send({
    method: "session/update",
    params: { sessionId: nativeId, update: { sessionUpdate, ...fields } },
  });
  const text = (value) => update("agent_message_chunk", { content: { type: "text", text: value } });
  const controls = () => ({
    configOptions: [{
      id: "e2e-model-selector", name: "Model", type: "select", category: "model",
      currentValue: state.modelId,
      options: [
        { value: "e2e-model-a", name: "E2E model A" },
        { value: "e2e-model-b", name: "E2E model B" },
      ],
    }],
  });
  const finish = (request, reply, known = true) => {
    text(reply);
    result(request, {
      stopReason: "end_turn",
      ...(known ? { usage: { inputTokens: 11, outputTokens: 7, cachedReadTokens: 3, cachedWriteTokens: 2 } } : {}),
    });
  };
  if (pidFile) writeFileSync(pidFile, JSON.stringify({ parentPid: process.pid }));

  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    const params = request.params ?? {};
    switch (request.method) {
      case "initialize":
        result(request, {
          protocolVersion: 1,
          agentInfo: { name: "Oleafly E2E agent", version: "1.0.0" },
          agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
          authMethods: [{ id: "e2e-login", name: "Sign in to E2E agent" }],
        });
        break;
      case "authenticate":
        state = { ...state, authenticated: true };
        saveState();
        result(request, {});
        break;
      case "session/new":
      case "session/load":
        projectRoot = params.cwd;
        if (!state.authenticated) {
          send({ id: request.id, error: { code: -32000, message: "Authentication required" } });
          break;
        }
        if (request.method === "session/load") {
          nativeId = params.sessionId;
          text("ACP replay sentinel");
        }
        result(request, { sessionId: nativeId, ...controls() });
        break;
      case "session/set_config_option":
        state = { ...state, modelId: params.value };
        saveState();
        result(request, controls());
        break;
      case "session/prompt": {
        const prompt = params.prompt.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        const toolId = `e2e-read-${++turn}`;
        update("agent_thought_chunk", { content: { type: "text", text: "Checking local E2E evidence." } });
        update("tool_call", { toolCallId: toolId, title: "Read E2E evidence", kind: "read", status: "in_progress" });
        update("tool_call_update", { toolCallId: toolId, status: "completed", content: [{ type: "content", content: { type: "text", text: "Local evidence read." } }] });
        if (prompt.startsWith("permission ")) {
          pending = { request, prompt, permissionId: `e2e-permission-${turn}` };
          send({
            id: pending.permissionId,
            method: "session/request_permission",
            params: {
              sessionId: nativeId,
              toolCall: { toolCallId: `e2e-write-${turn}`, title: "Review the E2E manuscript", locations: [{ path: join(projectRoot, "main.tex") }] },
              options: [
                { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
                { optionId: "reject-once", name: "Reject", kind: "reject_once" },
              ],
            },
          });
        } else if (prompt.startsWith("wait ")) {
          const child = spawn(process.execPath, [process.argv[1], "--child"], { stdio: "ignore" });
          child.once("spawn", () => {
            if (pidFile) writeFileSync(pidFile, JSON.stringify({ parentPid: process.pid, childPid: child.pid }));
            text("ACP fixture waiting for cancellation.");
          });
          pending = { request, prompt };
        } else {
          update("usage_update", { used: 900, size: 32_000 });
          finish(request, `ACP fixture answer: ${prompt}`, !prompt.startsWith("unknown "));
        }
        break;
      }
      case "session/cancel":
        if (pending) {
          result(pending.request, { stopReason: "cancelled" });
          pending = null;
        }
        break;
      default:
        if (pending?.permissionId === request.id && request.result) {
          const outcome = request.result.outcome;
          const allowed = outcome?.outcome === "selected" && outcome.optionId === "allow-once";
          finish(pending.request, `ACP fixture ${allowed ? "approved" : "rejected"}: ${pending.prompt}`);
          pending = null;
        } else if (request.method) {
          send({ id: request.id, error: { code: -32601, message: "Unsupported E2E method" } });
        }
    }
  }
}
