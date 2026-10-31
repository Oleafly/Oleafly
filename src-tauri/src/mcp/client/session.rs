use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{json, Value};

use super::{
    discover_server, initialize_legacy, list_tools, tool_call_request, tool_call_result,
    McpConnectionError, McpServerTool, StdioTransport,
};

const FIRST_CALL_ID: u64 = 100;

#[derive(Clone, Copy, Debug)]
pub(crate) struct McpSessionLimits {
    pub max_message_bytes: usize,
    pub probe_timeout: Duration,
    pub open_timeout: Duration,
}

pub(crate) struct McpStdioSession {
    transport: StdioTransport,
    modern: bool,
    next_id: u64,
    tools: Vec<McpServerTool>,
}

impl McpStdioSession {
    pub(crate) async fn open(
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        limits: McpSessionLimits,
    ) -> Result<Self, String> {
        match tokio::time::timeout(
            limits.open_timeout,
            Self::open_inner(command, args, env, limits),
        )
        .await
        {
            Ok(Ok(session)) => Ok(session),
            Ok(Err(error)) => Err(error.to_string()),
            Err(_) => Err(format!(
                "The MCP server did not finish starting within {} seconds.",
                limits.open_timeout.as_secs().max(1)
            )),
        }
    }

    async fn open_inner(
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        limits: McpSessionLimits,
    ) -> Result<Self, McpConnectionError> {
        let mut probe = StdioTransport::spawn(command, args, env).await?;
        probe.max_message_bytes = limits.max_message_bytes;
        let discovery =
            tokio::time::timeout(limits.probe_timeout, discover_server(&mut probe)).await;
        match discovery {
            Ok(Ok(true)) => {
                let tools = list_tools(&mut probe, 2, true).await?;
                Ok(Self {
                    transport: probe,
                    modern: true,
                    next_id: FIRST_CALL_ID,
                    tools,
                })
            }
            Ok(Err(error @ McpConnectionError::ModernProtocol { .. })) => {
                probe.shutdown().await;
                Err(error)
            }
            Ok(Ok(false)) | Ok(Err(_)) | Err(_) => {
                probe.shutdown().await;
                let mut transport = StdioTransport::spawn(command, args, env).await?;
                transport.max_message_bytes = limits.max_message_bytes;
                initialize_legacy(&mut transport).await?;
                let tools = list_tools(&mut transport, 3, false).await?;
                Ok(Self {
                    transport,
                    modern: false,
                    next_id: FIRST_CALL_ID,
                    tools,
                })
            }
        }
    }

    pub(crate) fn tools(&self) -> &[McpServerTool] {
        &self.tools
    }

    #[cfg(test)]
    pub(crate) async fn call(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        self.call_checked(name, arguments).await?
    }

    pub(crate) async fn call_checked(
        &mut self,
        name: &str,
        arguments: Value,
    ) -> Result<Result<Value, String>, String> {
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        let request = tool_call_request(id, name, arguments, self.modern);
        self.transport
            .write_message(&request)
            .await
            .map_err(|error| error.to_string())?;
        let response = self
            .read_until(id)
            .await
            .map_err(|error| error.to_string())?;
        Ok(tool_call_result(&response, id, self.modern).map_err(|error| error.to_string()))
    }

    async fn read_until(&mut self, id: u64) -> Result<Value, McpConnectionError> {
        let expected = json!(id);
        loop {
            let message = self.transport.read_message().await?;
            let method = message.get("method").and_then(Value::as_str);
            match (method, message.get("id")) {
                (Some(method), Some(request_id)) => {
                    let reply = if method == "ping" {
                        json!({"jsonrpc": "2.0", "id": request_id, "result": {}})
                    } else {
                        json!({
                            "jsonrpc": "2.0",
                            "id": request_id,
                            "error": {"code": -32601, "message": "Method not found"},
                        })
                    };
                    self.transport.write_message(&reply).await?;
                }
                (Some(_), None) => {}
                (None, Some(response_id)) if response_id == &expected => return Ok(message),
                _ => {}
            }
        }
    }

    #[cfg(test)]
    pub(crate) async fn close(self) {
        self.transport.shutdown().await;
    }

    #[cfg(test)]
    pub(crate) fn pid(&self) -> Option<u32> {
        self.transport.child.id()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits(max_message_bytes: usize) -> McpSessionLimits {
        McpSessionLimits {
            max_message_bytes,
            probe_timeout: Duration::from_millis(500),
            open_timeout: Duration::from_secs(20),
        }
    }

    const LEGACY_PRELUDE: &str = concat!(
        "const readline=require('node:readline');",
        "const lines=readline.createInterface({input:process.stdin});",
        "let inits=0;",
        "const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');",
        "const list=(m)=>send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'probe',description:'p'+process.pid,inputSchema:{type:'object'}}]}});",
    );

    async fn open(script: &str, max_message_bytes: usize) -> McpStdioSession {
        McpStdioSession::open(
            "node",
            &["-e".into(), script.into()],
            &BTreeMap::new(),
            limits(max_message_bytes),
        )
        .await
        .unwrap()
    }

    fn text(result: &Value) -> String {
        result["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    }

    #[tokio::test]
    async fn a_session_serves_several_calls_on_one_process() {
        let script = format!(
            "{LEGACY_PRELUDE}{}",
            concat!(
                "lines.on('line',(line)=>{const m=JSON.parse(line);",
                "if(m.method==='server/discover'){send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});}",
                "if(m.method==='initialize'){inits+=1;send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'count',version:'1'}}});}",
                "if(m.method==='tools/list'){list(m);}",
                "if(m.method==='tools/call'){send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify({inits,id:m.id,pid:process.pid})}]}});}",
                "});",
            )
        );
        let mut session = open(&script, 1024 * 1024).await;
        let mut ids = Vec::new();
        let mut pids = Vec::new();
        for _ in 0..3 {
            let result = session.call("probe", json!({})).await.unwrap();
            let body: Value = serde_json::from_str(&text(&result)).unwrap();
            assert_eq!(body["inits"], 1);
            ids.push(body["id"].as_u64().unwrap());
            pids.push(body["pid"].as_u64().unwrap());
        }
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]), "{ids:?}");
        assert!(pids.iter().all(|pid| *pid == pids[0]), "{pids:?}");
        assert_eq!(session.tools()[0].name, "probe");
        session.close().await;
    }

    #[tokio::test]
    async fn a_late_answer_with_another_id_is_skipped() {
        let script = format!(
            "{LEGACY_PRELUDE}{}",
            concat!(
                "lines.on('line',(line)=>{const m=JSON.parse(line);",
                "if(m.method==='server/discover'){send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});}",
                "if(m.method==='initialize'){send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'late',version:'1'}}});}",
                "if(m.method==='tools/list'){list(m);}",
                "if(m.method==='tools/call'){send({jsonrpc:'2.0',id:999,result:{content:[{type:'text',text:'stale'}]}});send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'fresh'}]}});}",
                "});",
            )
        );
        let mut session = open(&script, 1024 * 1024).await;
        let result = session.call("probe", json!({})).await.unwrap();
        assert_eq!(text(&result), "fresh");
        session.close().await;
    }

    #[tokio::test]
    async fn notifications_are_ignored_and_server_requests_get_answers() {
        let script = format!(
            "{LEGACY_PRELUDE}{}",
            concat!(
                "let pending=null;let ping=false;",
                "lines.on('line',(line)=>{const m=JSON.parse(line);",
                "if(m.method==='server/discover'){send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});return;}",
                "if(m.method==='initialize'){send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'asks',version:'1'}}});return;}",
                "if(m.method==='tools/list'){list(m);return;}",
                "if(m.method==='tools/call'){pending=m.id;send({jsonrpc:'2.0',method:'notifications/message',params:{level:'info',data:'working'}});send({jsonrpc:'2.0',id:'s1',method:'ping'});return;}",
                "if(m.id==='s1'){ping=JSON.stringify(m.result)==='{}';send({jsonrpc:'2.0',id:'s2',method:'roots/list'});return;}",
                "if(m.id==='s2'){const refused=m.error&&m.error.code===-32601;send({jsonrpc:'2.0',id:pending,result:{content:[{type:'text',text:(ping&&refused)?'answered':'wrong'}]}});}",
                "});",
            )
        );
        let mut session = open(&script, 1024 * 1024).await;
        let result = session.call("probe", json!({})).await.unwrap();
        assert_eq!(text(&result), "answered");
        session.close().await;
    }

    fn sized_reply_script(bytes: usize) -> String {
        format!(
            "{LEGACY_PRELUDE}{}",
            concat!(
                "lines.on('line',(line)=>{const m=JSON.parse(line);",
                "if(m.method==='server/discover'){send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});}",
                "if(m.method==='initialize'){send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'big',version:'1'}}});}",
                "if(m.method==='tools/list'){list(m);}",
                "if(m.method==='tools/call'){send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'x'.repeat(SIZE)}]}});}",
                "});",
            )
        )
        .replace("SIZE", &bytes.to_string())
    }

    #[tokio::test]
    async fn a_message_over_the_limit_fails_and_one_under_it_passes() {
        let mut small = open(&sized_reply_script(80 * 1024), 64 * 1024).await;
        let error = small.call("probe", json!({})).await.unwrap_err();
        assert!(error.contains("limit"), "{error}");
        assert!(error.contains("64 KiB"), "{error}");
        drop(small);

        let mut large = open(&sized_reply_script(3 * 1024 * 1024), 16 * 1024 * 1024).await;
        let result = large.call("probe", json!({})).await.unwrap();
        assert_eq!(text(&result).len(), 3 * 1024 * 1024);
        large.close().await;
    }

    #[tokio::test]
    async fn legacy_servers_get_a_fresh_process_after_the_probe() {
        let script = concat!(
            "const readline=require('node:readline');",
            "let probed=false;",
            "const lines=readline.createInterface({input:process.stdin});",
            "const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');",
            "lines.on('line',(line)=>{const m=JSON.parse(line);",
            "if(m.method==='server/discover'){probed=true;return;}",
            "if(m.method==='initialize'){send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'silent',version:'1'}}});}",
            "if(m.method==='tools/list'){send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:probed?'probed':'fresh',inputSchema:{type:'object'}}]}});}",
            "});",
        );
        let session = McpStdioSession::open(
            "node",
            &["-e".into(), script.into()],
            &BTreeMap::new(),
            McpSessionLimits {
                max_message_bytes: 1024 * 1024,
                probe_timeout: Duration::from_millis(300),
                open_timeout: Duration::from_secs(20),
            },
        )
        .await
        .unwrap();
        assert_eq!(session.tools()[0].name, "fresh");
        session.close().await;
    }

    #[tokio::test]
    async fn dropping_a_session_mid_call_kills_the_process() {
        let script = format!(
            "{LEGACY_PRELUDE}{}",
            concat!(
                "lines.on('line',(line)=>{const m=JSON.parse(line);",
                "if(m.method==='server/discover'){send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});}",
                "if(m.method==='initialize'){send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'hang',version:'1'}}});}",
                "if(m.method==='tools/list'){list(m);}",
                "});",
            )
        );
        let session = open(&script, 1024 * 1024).await;
        let pid = session.pid().expect("the session has a process");
        let call = async move {
            let mut session = session;
            session.call("probe", json!({})).await
        };
        assert!(tokio::time::timeout(Duration::from_millis(300), call)
            .await
            .is_err());
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            if crate::process_identity::probe(pid) == crate::process_identity::ProcessProbe::Gone {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "the server process survived its session"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    #[tokio::test]
    async fn a_missing_command_is_named() {
        let error = McpStdioSession::open(
            "oleafly-command-that-does-not-exist",
            &[],
            &BTreeMap::new(),
            limits(1024),
        )
        .await
        .err()
        .unwrap();
        assert!(error.contains("command not found"), "{error}");
    }
}
