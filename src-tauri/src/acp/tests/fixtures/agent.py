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
# Agent checks start in an empty Oleafly-owned folder rather than the project.
fixture_root = declared_root if "--fixture-any-cwd" in sys.argv else Path.cwd().resolve().parent
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
pending_kind = None
ignore_cancel = False
credential = ""
pid_file = sys.argv[1] if len(sys.argv) > 1 else ""
protocol = 1
options = {"mode": argument("--start-mode") or "default", "model": "opus", "effort": "default", "fast": False}

if "--record-launch-count" in sys.argv:
    with open(declared_root / "launches.log", "a") as log:
        log.write("start\n")

def requests_log():
    # A sandboxed task agent can only write in its home, a folder directly
    # inside the harness directory.
    folder = argument("--requests-dir")
    if folder is None:
        return declared_root / "requests.jsonl"
    path = Path(folder)
    if ".." in path.parts or not path.is_absolute():
        raise ValueError("Fixture paths cannot contain parent traversal")
    path = path.resolve(strict=True)
    if not path.is_dir() or not path.parent.samefile(fixture_root):
        raise ValueError("Use a folder directly inside the harness directory")
    return path / "requests.jsonl"

def record_request(message):
    if "--record-requests" in sys.argv:
        with open(requests_log(), "a") as log:
            log.write(json.dumps({"method": message.get("method"), "params": message.get("params")}) + "\n")

def claude_options():
    return [
        {"id": "mode", "name": "Mode", "category": "mode", "type": "select", "currentValue": options["mode"],
         "options": [{"value": "default", "name": "Default"}, {"value": "plan", "name": "Plan"},
                     {"value": "bypassPermissions", "name": "Bypass permissions"}]},
        {"id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": options["model"],
         "options": [{"value": "opus", "name": "Opus"}, {"value": "sonnet", "name": "Sonnet"}]},
        {"id": "effort", "name": "Effort", "category": "thought_level", "type": "select", "currentValue": options["effort"],
         "options": [{"value": "default", "name": "Default"}, {"value": "low", "name": "Low"}, {"value": "high", "name": "High"}]},
        {"id": "fast", "name": "Fast mode", "category": "model_config", "type": "boolean", "currentValue": options["fast"]},
    ]

def session_result():
    if "--claude-options" in sys.argv:
        return {"sessionId": native_id, "configOptions": claude_options()}
    if "--legacy-modes" in sys.argv:
        return {"sessionId": native_id,
                "modes": {"currentModeId": options["mode"], "availableModes": [{"id": "default", "name": "Default"}, {"id": "plan", "name": "Plan"}, {"id": "yolo", "name": "YOLO"}]},
                "models": {"currentModelId": "fixture-model", "availableModels": [{"modelId": "fixture-model", "name": "Fixture model"}]}}
    return None

def auth_methods():
    methods = [{"id": "fixture-login", "name": "Fixture sign-in"}]
    if "--api-key-method" in sys.argv:
        methods.append({"id": "api-key", "name": "API key", "_meta": {"api-key": {"provider": "openai"}}})
        methods.append({"id": "terminal-login", "name": "Log in", "type": "terminal", "args": ["--login"],
                        "env": {"PATH": "/evil", "CLAUDE_CODE_ENTRYPOINT": "acp"}})
    return methods

def v126_capabilities():
    return {"loadSession": True, "promptCapabilities": {"image": True, "embeddedContext": True},
            "mcpCapabilities": {"http": True},
            "sessionCapabilities": {"list": {}, "resume": {}, "close": {}, "delete": {}, "fork": {}},
            "auth": {"logout": {}}, "providers": {}, "_meta": {"authStatus": {}}}

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
    record_request(request)
    if method == "initialize" and "--v2" in sys.argv and params.get("protocolVersion") == 2:
        protocol = 2
        result(request, {"protocolVersion": 2, "info": {"name": "fixture", "version": "2.0.0"},
                         "capabilities": {"session": {"prompt": {"image": {}}, "mcp": {"http": {}}}},
                         "authMethods": []})
    elif method == "initialize" and "--caps-v126" in sys.argv:
        result(request, {"protocolVersion": 1, "agentInfo": {"name": "fixture", "version": "1.2.6"},
                         "agentCapabilities": v126_capabilities(), "authMethods": auth_methods(),
                         "_meta": {"steering": {"supported": True}}})
    elif method == "initialize" and "--api-key-method" in sys.argv:
        result(request, {"protocolVersion": 1, "agentInfo": {"name": "fixture", "version": "1.2.3"},
                         "agentCapabilities": {"loadSession": True, "promptCapabilities": {"image": True}, "mcpCapabilities": {"http": True}},
                         "authMethods": auth_methods()})
    elif method == "initialize":
        if "--stderr-crash" in sys.argv:
            print("fixture cannot start: missing runtime", file=sys.stderr, flush=True)
            sys.exit(4)
        if "--initialize-barrier" in sys.argv:
            write_pid(os.getpid())
            time.sleep(300)
        if "--record-git-env" in sys.argv:
            (declared_root / "git-env.json").write_text(json.dumps({key: value for key, value in os.environ.items() if key.startswith("GIT_CONFIG")}))
        mcp_capabilities = {} if "--no-http-mcp" in sys.argv else {"http": True}
        result(request, {"protocolVersion": 1, "agentInfo": {"name": "fixture", "version": "1.2.3"}, "agentCapabilities": {"loadSession": True, "promptCapabilities": {"image": True}, "mcpCapabilities": mcp_capabilities}, "authMethods": [{"id": "fixture-login", "name": "Fixture sign-in"}]})
    elif method in ("authenticate", "auth/login"):
        key = ((params.get("_meta") or {}).get("api-key") or {}).get("apiKey")
        if key and "--echo-key-error" in sys.argv:
            send({"id": request["id"], "error": {"code": -32603, "message": "Key " + key + " was refused"}})
        else:
            authenticated = True
            result(request, {})
    elif method in ("logout", "auth/logout"):
        authenticated = False
        result(request, {})
    elif method == "providers/list":
        result(request, {"providers": [{"providerId": "main", "supported": ["anthropic", "openai"], "required": False}]})
    elif method in ("providers/set", "providers/disable"):
        if "--echo-provider-error" in sys.argv and method == "providers/set":
            send({"id": request["id"], "error": {"code": -32603, "message": "Bad headers " + json.dumps(params.get("headers"))}})
        else:
            result(request, {})
    elif method == "session/list":
        cursor = params.get("cursor")
        here = params.get("cwd")
        if cursor is None:
            result(request, {"sessions": [{"sessionId": "agent-one", "cwd": here, "title": "Chapter one"},
                                          {"sessionId": "agent-elsewhere", "cwd": "/elsewhere", "title": "Other project"}],
                             "nextCursor": "page-2"})
        else:
            result(request, {"sessions": [{"sessionId": "agent-two", "cwd": here, "title": "Chapter two"}]})
    elif method == "session/delete":
        result(request, {})
    elif method == "session/fork":
        # Updates for the new session around its reply, as bridges send them.
        around = {"method": "session/update", "params": {"sessionId": "fixture-fork", "update": {"sessionUpdate": "available_commands_update", "availableCommands": [{"name": "review", "description": "Review changes"}]}}}
        if "--update-around-fork" in sys.argv:
            send(around)
        result(request, {"sessionId": "fixture-fork"})
        if "--update-around-fork" in sys.argv:
            send(around)
    elif method == "session/close":
        result(request, {})
    elif method == "session/resume":
        native_id = params.get("sessionId", native_id)
        result(request, session_result() or {"configOptions": [{"id": "model-selector", "name": "Model", "type": "select", "category": "model", "currentValue": "fixture-model", "options": [{"value": "fixture-model", "name": "Fixture model"}]}]})
    elif method == "session/set_mode":
        options["mode"] = params.get("modeId")
        result(request, {})
    elif method == "_session/steering":
        if pending_prompt is not None:
            result(request, {"outcome": "injected"})
            text = params["prompt"][0]["text"]
            update("agent_message_chunk", content={"type": "text", "text": "Steered: " + text})
            result(pending_prompt, {"stopReason": "end_turn"})
            pending_prompt = None
        else:
            result(request, {"outcome": "promptRequired"})
    elif request.get("id") == "read-wire" and pending_prompt:
        if "error" in request:
            update("agent_message_chunk", content={"type": "text", "text": "Read failed " + str(request["error"]["code"])})
        else:
            update("agent_message_chunk", content={"type": "text", "text": "Read: " + request["result"]["content"]})
        result(pending_prompt, {"stopReason": "end_turn"})
        pending_prompt = None
    elif request.get("id") == "elicit-wire" and pending_prompt:
        answer = request.get("result", {})
        update("agent_message_chunk", content={"type": "text", "text": "Answer: " + str(answer.get("action"))})
        result(pending_prompt, {"stopReason": "end_turn"})
        pending_prompt = None
    elif method == "session/new":
        servers = params.get("mcpServers", [])
        if "--record-mcp-servers" in sys.argv:
            (declared_root / "mcp-servers.json").write_text(json.dumps(servers))
        if "--record-launch" in sys.argv:
            (declared_root / "launch.json").write_text(json.dumps({"cwd": params.get("cwd"), "processCwd": os.getcwd(), "path": os.environ.get("PATH", ""), "noCwdSearch": os.environ.get("NoDefaultCurrentDirectoryInExePath")}))
        if servers and servers[0].get("headers"):
            credential = servers[0]["headers"][0]["value"].removeprefix("Bearer ")
        if not authenticated:
            send({"id": request["id"], "error": {"code": -32000, "message": "Authentication required"}})
        elif protocol == 2:
            result(request, {"sessionId": native_id})
        elif session_result() is not None:
            result(request, session_result())
            if "--commands-on-start" in sys.argv:
                update("available_commands_update", availableCommands=[
                    {"name": "usage", "description": "Show plan usage"},
                    {"name": "review", "description": "Review changes", "input": {"hint": "file"}}])
        else:
            if "--commands-on-start" in sys.argv:
                result(request, {"sessionId": native_id, "configOptions": []})
                update("available_commands_update", availableCommands=[
                    {"name": "usage", "description": "Show plan usage"},
                    {"name": "review", "description": "Review changes", "input": {"hint": "file"}}])
                continue
            if "--leak-session-id" in sys.argv:
                native_id = credential
            config_id = credential if "--leak-config-id" in sys.argv else "model-selector"
            current_value = credential if "--leak-config-value" in sys.argv else "fixture-model"
            result(request, {"sessionId": native_id, "configOptions": [{"id": config_id, "name": "Model", "type": "select", "category": "model", "currentValue": current_value, "options": [{"value": "fixture-model", "name": "Fixture model"}, {"value": "fixture-second", "name": "Second model"}]}]})
    elif method == "session/load":
        for index in range(100):
            update("agent_message_chunk", content={"type": "text", "text": "Replayed history " + str(index)})
        result(request, {"models": {"currentModelId": "fixture-model", "availableModels": [{"modelId": "fixture-model", "name": "Fixture model"}]}})
    elif method == "session/set_config_option" and "--refuse-mode" in sys.argv and params.get("configId") == "mode":
        send({"id": request["id"], "error": {"code": -32602, "message": "The mode cannot change"}})
    elif method == "session/set_config_option" and ("--claude-options" in sys.argv):
        value = params.get("value")
        options[params["configId"]] = value
        result(request, {"configOptions": claude_options()})
    elif method == "session/set_config_option":
        if "--leak-model-response" in sys.argv:
            params["value"] = credential
        result(request, {"configOptions": [{"id": "model-selector", "name": "Model", "type": "select", "category": "model", "currentValue": params["value"], "options": [{"value": "fixture-model", "name": "Fixture model"}, {"value": "fixture-second", "name": "Second model"}]}]})
    elif method == "session/prompt" and protocol == 2:
        result(request, {"messageId": "accepted-1"})
        text = params["prompt"][0]["text"]
        update("agent_message", messageId="m1", content=[{"type": "text", "text": "Fixture "}])
        update("agent_message", messageId="m1", content=[{"type": "text", "text": "Fixture v2: " + text}])
        update("state_update", state="idle", stopReason="end_turn")
        if text == "late-after-idle":
            update("agent_message", messageId="m2", content=[{"type": "text", "text": "Late after idle"}])
    elif method == "session/prompt":
        prompt = params["prompt"][0]["text"]
        if "--record-prompt" in sys.argv:
            (declared_root / "prompt.json").write_text(json.dumps(params["prompt"]))
        if prompt.startswith("read-file:") or prompt.startswith("read-abs:") or prompt.startswith("read-lines:"):
            pending_prompt = request
            target = prompt.split(":", 1)[1]
            path = target if prompt.startswith("read-abs:") else os.path.join(os.getcwd(), target)
            read = {"sessionId": native_id, "path": path}
            if prompt.startswith("read-lines:"):
                read["line"] = 3
                read["limit"] = 2
            send({"id": "read-wire", "method": "fs/read_text_file", "params": read})
            continue
        if prompt == "ask-form":
            pending_prompt = request
            send({"id": "elicit-wire", "method": "elicitation/create", "params": {
                "mode": "form", "sessionId": native_id, "message": "Pick a region",
                "requestedSchema": {"type": "object", "properties": {
                    "region": {"type": "string", "enum": ["eu", "us"]},
                    "token": {"type": "string", "title": "Access token"}}, "required": ["region"]}}})
            continue
        if prompt == "ask-url":
            pending_prompt = request
            send({"id": "elicit-wire", "method": "elicitation/create", "params": {
                "mode": "url", "sessionId": native_id, "elicitationId": "e1",
                "url": "https://example.org/device", "message": "Open the link"}})
            time.sleep(0.3)
            send({"method": "elicitation/complete", "params": {"elicitationId": "e1"}})
            continue
        if prompt == "usage-meta":
            update("usage_update", used=900, size=200000, cost={"amount": 0.42, "currency": "USD"},
                   _meta={"_claude/rateLimit": {"rateLimitType": "five_hour", "status": "allowed_warning", "utilization": 0.82, "resetsAt": 1760000000},
                          "_claude/model": "opus"})
            result(request, {"stopReason": "end_turn", "usage": {"inputTokens": 5, "outputTokens": 2, "thoughtTokens": 1}})
            continue
        if prompt in ("/usage", "/status"):
            update("agent_message_chunk", content={"type": "text", "text": "## Usage\n"})
            update("agent_message_chunk", content={"type": "text", "text": "Session: 10% used"})
            result(request, {"stopReason": "end_turn"})
            continue
        if prompt.startswith("burst:"):
            for index in range(int(prompt.split(":", 1)[1])):
                update("agent_message_chunk", content={"type": "text", "text": "x"})
            result(request, {"stopReason": "end_turn"})
            continue
        if prompt == "chunks-then-tool":
            update("agent_message_chunk", content={"type": "text", "text": "Before "})
            update("agent_message_chunk", content={"type": "text", "text": "tool."})
            update("tool_call", toolCallId="t-9", title="Read", kind="read", status="completed")
            update("agent_message_chunk", content={"type": "text", "text": "After."})
            result(request, {"stopReason": "end_turn"})
            continue
        if prompt == "slow-silent":
            pending_prompt = request
            continue
        if prompt == "go-bypass":
            options["mode"] = "bypassPermissions"
            update("config_option_update", configOptions=claude_options())
            result(request, {"stopReason": "end_turn"})
            continue
        if prompt == "outside-events":
            result(request, {"stopReason": "end_turn"})
            update("session_info_update", title="Agent title")
            update("notice", severity="warning", title="Heads up", description="d" * 5000)
            update("compaction_update", compactionId="c1", status="in_progress")
            for part in ("a", "b", "c"):
                update("compaction_summary_chunk", compactionId="c1", content={"type": "text", "text": part})
            update("compaction_update", compactionId="c1", status="completed")
            update("future_thing", value=1)
            update("agent_message_chunk", content={"type": "text", "text": "Not kept outside a turn"})
            continue
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
            send({"id": request["id"], "error": {"code": -32603, "message": "Agent failure " + credential}})
        elif prompt == "auth-expired":
            update("agent_message_chunk", content={"type": "text", "text": "Failed to authenticate: OAuth session expired and could not be refreshed"})
            send({"id": request["id"], "error": {"code": -32603, "message": "Internal error: Failed to authenticate: OAuth session expired and could not be refreshed"}})
        elif prompt in ("permission", "outside-permission", "leak-permission-tool", "leak-permission-option"):
            pending_prompt = request
            path = "/etc/passwd" if prompt == "outside-permission" else os.path.join(params.get("cwd", os.getcwd()), "paper.tex")
            send({"id": "permission-wire", "method": "session/request_permission", "params": {"sessionId": native_id, "toolCall": {"toolCallId": credential if prompt == "leak-permission-tool" else "write-1", "title": "Update paper", "locations": [{"path": path}]}, "options": [{"optionId": credential if prompt == "leak-permission-option" else "yes", "name": "Allow once", "kind": "allow_once"}, {"optionId": "no", "name": "Reject", "kind": "reject_once"}]}})
        elif prompt in ("hang", "hang-ignore-cancel"):
            child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
            write_pid(child.pid)
            pending_prompt = request
            ignore_cancel = prompt == "hang-ignore-cancel"
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
        elif prompt == "missing-stop":
            update("agent_message_chunk", content={"type": "text", "text": "Partial saved answer"})
            result(request, {})
        elif prompt.startswith("stop:"):
            update("agent_message_chunk", content={"type": "text", "text": "Partial saved answer"})
            result(request, {"stopReason": prompt.removeprefix("stop:")})
        elif prompt == "large-output":
            target = os.path.join(os.getcwd(), "refs.bib")
            update("tool_call_update", toolCallId="read-1", status="completed", content=[{"type": "content", "content": {"type": "text", "text": "r" * (300 * 1024)}}, {"type": "diff", "path": target, "oldText": "o" * (150 * 1024), "newText": "n" * (151 * 1024)}])
            result(request, {"stopReason": "end_turn"})
        elif prompt == "huge-update":
            update("tool_call_update", toolCallId="read-1", status="completed", content=[{"type": "content", "content": {"type": "text", "text": "h" * (3 * 1024 * 1024)}}])
            update("agent_message_chunk", content={"type": "text", "text": "After the large update"})
            result(request, {"stopReason": "end_turn"})
        elif prompt == "permission-diff":
            pending_prompt = request
            target = os.path.join(os.getcwd(), "paper.tex")
            update("tool_call", toolCallId="edit-1", title="Edit paper", kind="edit", status="pending", locations=[{"path": target}], content=[{"type": "diff", "path": target, "oldText": "Old sentence.\n", "newText": "New sentence.\npassword = " + raw_input_marker + "\n"}])
            send({"id": "permission-wire", "method": "session/request_permission", "params": {"sessionId": native_id, "toolCall": {"toolCallId": "edit-1", "title": "Edit paper"}, "options": [{"optionId": "yes", "name": "Allow once", "kind": "allow_once"}, {"optionId": "no", "name": "Reject", "kind": "reject_once"}]}})
        elif prompt.startswith("ask-permission:"):
            pending_prompt = request
            spec = json.loads(prompt[len("ask-permission:"):])
            tool = {"toolCallId": "ask-1", "title": "Read a file", "locations": [{"path": spec["path"]}], "rawInput": {"file_path": spec["path"]}}
            if spec.get("kind"):
                tool["kind"] = spec["kind"]
            send({"id": "permission-wire", "method": "session/request_permission", "params": {"sessionId": native_id, "toolCall": tool, "options": [{"optionId": "yes", "name": "Allow once", "kind": "allow_once"}, {"optionId": "no", "name": "Reject", "kind": "reject_once"}]}})
        elif prompt.startswith("announced-permission:"):
            # The call is announced with its paths; the request names only its id.
            pending_prompt = request
            spec = json.loads(prompt[len("announced-permission:"):])
            announced = {"toolCallId": "announced-1", "title": "Change a file", "status": "pending"}
            if spec.get("kind"):
                announced["kind"] = spec["kind"]
            if spec.get("path"):
                announced["locations"] = [{"path": spec["path"]}]
            if spec.get("raw"):
                announced["rawInput"] = spec["raw"]
            update("tool_call", **announced)
            send({"id": "permission-wire", "method": "session/request_permission", "params": {"sessionId": native_id, "toolCall": {"toolCallId": "announced-1"}, "options": [{"optionId": "yes", "name": "Allow once", "kind": "allow_once"}, {"optionId": "no", "name": "Reject", "kind": "reject_once"}]}})
        elif prompt == "huge-edit":
            target = os.path.join(os.getcwd(), "refs.bib")
            update("tool_call", toolCallId="edit-big", title="Edit refs.bib", kind="edit", status="in_progress", locations=[{"path": target}])
            update("tool_call_update", toolCallId="edit-big", status="completed", content=[{"type": "diff", "path": target, "oldText": "o" * (600 * 1024), "newText": "n" * (601 * 1024)}])
            update("agent_message_chunk", content={"type": "text", "text": "Edited the bibliography."})
            result(request, {"stopReason": "end_turn"})
        elif prompt == "paged-answer":
            # One message per chunk, so each is its own stored event.
            for index in range(520):
                update("agent_message_chunk", messageId="m" + str(index), content={"type": "text", "text": str(index) + "|"})
            result(request, {"stopReason": "end_turn"})
        else:
            update("usage_update", used=900, size=32000)
            update("agent_message_chunk", content={"type": "text", "text": "Fixture answer: " + prompt})
            result(request, {"stopReason": "end_turn", "usage": {"inputTokens": 11, "outputTokens": 7, "cachedReadTokens": 3, "cachedWriteTokens": 2, "totalTokens": 23}})
    elif method == "session/cancel":
        if pending_prompt and not ignore_cancel:
            result(pending_prompt, {"stopReason": "cancelled"})
            pending_prompt = None
    elif request.get("id") == "permission-wire" and pending_prompt:
        update("agent_message_chunk", content={"type": "text", "text": "Permission outcome: " + request["result"]["outcome"]["outcome"]})
        result(pending_prompt, {"stopReason": "end_turn"})
        pending_prompt = None
    elif method:
        send({"id": request.get("id"), "error": {"code": -32601, "message": "Unsupported fixture method"}})
