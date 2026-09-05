import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

def argument(name):
    if name not in sys.argv:
        return None
    index = sys.argv.index(name) + 1
    if index >= len(sys.argv):
        raise ValueError("Missing fixture argument")
    return sys.argv[index]

declared_root = Path(argument("--fixture-root") or "").resolve(strict=True)
fixture_root = Path.cwd().resolve().parent
if not fixture_root.name.startswith("oleafly-acp-fixture-") or not declared_root.samefile(fixture_root):
    raise ValueError("Use an ACP harness temporary directory")

def fixture_path(value):
    path = Path(value)
    if ".." in path.parts:
        raise ValueError("Fixture paths cannot contain parent traversal")
    if not path.is_absolute():
        path = fixture_root / path
    if not path.parent.resolve(strict=True).samefile(fixture_root) or path.is_symlink():
        raise ValueError("Fixture files must be direct children of the harness directory")
    return fixture_root / path.name

def write_pid(value):
    path = fixture_path(pid_file)
    if path.parent != fixture_root or path.name not in ("agent.pid", "child.pid"):
        raise ValueError("Use a harness PID filename")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(str(value))

raw_input_marker = argument("--raw-input-marker") or secrets.token_hex(24)

native_id = "fixture-native"
authenticated = "--require-login" not in sys.argv
pending_prompt = None
credential = ""
pid_file = sys.argv[1] if len(sys.argv) > 1 else ""

def send(value):
    print(json.dumps({"jsonrpc": "2.0", **value}), flush=True)

def result(request, value):
    send({"id": request["id"], "result": value})

def update(session_update, **fields):
    send({"method": "session/update", "params": {"sessionId": native_id, "update": {"sessionUpdate": session_update, **fields}}})

for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    params = request.get("params", {})
    if method == "initialize":
        if "--initialize-barrier" in sys.argv:
            write_pid(os.getpid())
            time.sleep(300)
        result(request, {"protocolVersion": 1, "agentInfo": {"name": "fixture", "version": "1.2.3"}, "agentCapabilities": {"loadSession": True, "promptCapabilities": {"image": True}, "mcpCapabilities": {"http": True}}, "authMethods": [{"id": "fixture-login", "name": "Fixture sign-in"}]})
    elif method == "authenticate":
        authenticated = True
        result(request, {})
    elif method == "session/new":
        servers = params.get("mcpServers", [])
        if servers:
            credential = servers[0]["headers"][0]["value"].removeprefix("Bearer ")
        if not authenticated:
            send({"id": request["id"], "error": {"code": -32000, "message": "Authentication required"}})
        else:
            if "--leak-session-id" in sys.argv:
                native_id = credential
            config_id = credential if "--leak-config-id" in sys.argv else "model-selector"
            current_value = credential if "--leak-config-value" in sys.argv else "fixture-model"
            result(request, {"sessionId": native_id, "configOptions": [{"id": config_id, "name": "Model", "type": "select", "category": "model", "currentValue": current_value, "options": [{"value": "fixture-model", "name": "Fixture model"}, {"value": "fixture-second", "name": "Second model"}]}]})
    elif method == "session/load":
        for index in range(100):
            update("agent_message_chunk", content={"type": "text", "text": "Replayed history " + str(index)})
        result(request, {"models": {"currentModelId": "fixture-model", "availableModels": [{"modelId": "fixture-model", "name": "Fixture model"}]}})
    elif method == "session/set_config_option":
        if "--leak-model-response" in sys.argv:
            params["value"] = credential
        result(request, {"configOptions": [{"id": "model-selector", "name": "Model", "type": "select", "category": "model", "currentValue": params["value"], "options": [{"value": "fixture-model", "name": "Fixture model"}, {"value": "fixture-second", "name": "Second model"}]}]})
    elif method == "session/prompt":
        prompt = params["prompt"][0]["text"]
        update("agent_thought_chunk", content={"type": "text", "text": "Checking the fixture."})
        update("tool_call", toolCallId="read-1", title="Read fixture", kind="read", status="in_progress", rawInput={"password": raw_input_marker})
        update("tool_call_update", toolCallId="read-1", status="completed", content=[{"type": "content", "content": {"type": "text", "text": "Read complete."}}])
        if prompt == "leak-model":
            update("current_model_update", currentModelId=credential)
            result(request, {"stopReason": "end_turn"})
        elif prompt == "leak-config":
            update("config_option_update", configOptions=[{"id": "model-selector", "type": "select", "category": "model", "currentValue": credential, "options": []}])
            result(request, {"stopReason": "end_turn"})
        elif prompt == "leak-error":
            send({"id": request["id"], "error": {"code": -32000, "message": "Agent failure " + credential}})
        elif prompt in ("permission", "outside-permission", "leak-permission-tool", "leak-permission-option"):
            pending_prompt = request
            path = "/etc/passwd" if prompt == "outside-permission" else os.path.join(params.get("cwd", os.getcwd()), "paper.tex")
            send({"id": "permission-wire", "method": "session/request_permission", "params": {"sessionId": native_id, "toolCall": {"toolCallId": credential if prompt == "leak-permission-tool" else "write-1", "title": "Update paper", "locations": [{"path": path}]}, "options": [{"optionId": credential if prompt == "leak-permission-option" else "yes", "name": "Allow once", "kind": "allow_once"}, {"optionId": "no", "name": "Reject", "kind": "reject_once"}]}})
        elif prompt == "hang":
            child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
            write_pid(child.pid)
            pending_prompt = request
        elif prompt == "scope-probe":
            probe_path = fixture_path(sys.argv[2])
            try:
                with probe_path.open() as handle:
                    handle.read()
                outcome = "outside read allowed"
            except PermissionError:
                outcome = "outside read denied"
            update("agent_message_chunk", content={"type": "text", "text": outcome})
            result(request, {"stopReason": "end_turn"})
        elif prompt == "crash":
            update("agent_message_chunk", content={"type": "text", "text": "Partial saved answer"})
            sys.exit(3)
        else:
            update("usage_update", used=900, size=32000)
            update("agent_message_chunk", content={"type": "text", "text": "Fixture answer: " + prompt})
            result(request, {"stopReason": "end_turn", "usage": {"inputTokens": 11, "outputTokens": 7, "cachedReadTokens": 3, "cachedWriteTokens": 2, "totalTokens": 23}})
    elif method == "session/cancel":
        if pending_prompt:
            result(pending_prompt, {"stopReason": "cancelled"})
            pending_prompt = None
    elif request.get("id") == "permission-wire" and pending_prompt:
        update("agent_message_chunk", content={"type": "text", "text": "Permission outcome: " + request["result"]["outcome"]["outcome"]})
        result(pending_prompt, {"stopReason": "end_turn"})
        pending_prompt = None
    elif method:
        send({"id": request.get("id"), "error": {"code": -32601, "message": "Unsupported fixture method"}})
