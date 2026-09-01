use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex};
use tauri::{AppHandle, Manager, Runtime, Webview};

use crate::commands::{Command, CommandEnvelope, Response, WindowInfo};
use crate::native_capture::RecordingSession;

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub type PendingResults = Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>;
pub type RecordingState = Arc<Mutex<Option<RecordingSession>>>;

pub fn start<R: Runtime>(
    app: AppHandle<R>,
    pending: PendingResults,
    socket_path: Option<String>,
    tcp_port: Option<u16>,
    window_label: Option<String>,
) {
    let app = Arc::new(app);
    let recording: RecordingState = Arc::new(Mutex::new(None));
    let window_label = Arc::new(window_label.unwrap_or_else(|| "main".to_string()));

    #[cfg(unix)]
    if let Some(path) = socket_path {
        let app = Arc::clone(&app);
        let pending = Arc::clone(&pending);
        let recording = Arc::clone(&recording);
        let window_label = Arc::clone(&window_label);
        tauri::async_runtime::spawn(async move {
            if let Err(e) = run_unix_server(app, pending, recording, &window_label, &path).await {
                eprintln!("tauri-plugin-playwright: unix server error: {}", e);
            }
        });
        return;
    }

    let port = tcp_port.unwrap_or(6274);
    let pending = Arc::clone(&pending);
    let recording = Arc::clone(&recording);
    let window_label = Arc::clone(&window_label);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_tcp_server(app, pending, recording, &window_label, port).await {
            eprintln!("tauri-plugin-playwright: tcp server error: {}", e);
        }
    });
}

#[cfg(unix)]
async fn run_unix_server<R: Runtime>(
    app: Arc<AppHandle<R>>,
    pending: PendingResults,
    recording: RecordingState,
    window_label: &str,
    path: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let _ = std::fs::remove_file(path);
    let listener = tokio::net::UnixListener::bind(path)?;
    eprintln!("tauri-plugin-playwright: listening on unix:{}", path);

    loop {
        let (stream, _) = listener.accept().await?;
        let app = Arc::clone(&app);
        let pending = Arc::clone(&pending);
        let recording = Arc::clone(&recording);
        let wl = window_label.to_string();
        tauri::async_runtime::spawn(async move {
            let (reader, writer) = stream.into_split();
            handle_connection(app, pending, recording, &wl, reader, writer).await;
        });
    }
}

async fn run_tcp_server<R: Runtime>(
    app: Arc<AppHandle<R>>,
    pending: PendingResults,
    recording: RecordingState,
    window_label: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    eprintln!("tauri-plugin-playwright: listening on tcp://127.0.0.1:{}", port);

    loop {
        let (stream, _) = listener.accept().await?;
        let app = Arc::clone(&app);
        let pending = Arc::clone(&pending);
        let recording = Arc::clone(&recording);
        let wl = window_label.to_string();
        tauri::async_runtime::spawn(async move {
            let (reader, writer) = stream.into_split();
            handle_connection(app, pending, recording, &wl, reader, writer).await;
        });
    }
}

async fn handle_connection<R: Runtime, Reader, Writer>(
    app: Arc<AppHandle<R>>,
    pending: PendingResults,
    recording: RecordingState,
    window_label: &str,
    reader: Reader,
    mut writer: Writer,
) where
    Reader: tokio::io::AsyncRead + Unpin,
    Writer: tokio::io::AsyncWrite + Unpin,
{
    let mut lines = BufReader::new(reader).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }

        let response = match serde_json::from_str::<CommandEnvelope>(&line) {
            Ok(envelope) => {
                let target = envelope.window.as_deref().unwrap_or(window_label);
                execute_command(&app, &pending, &recording, target, envelope.cmd).await
            }
            Err(e) => Response::err(format!("invalid command: {}", e)),
        };

        let mut json = serde_json::to_string(&response).unwrap_or_else(|_| {
            r#"{"ok":false,"error":"serialize error"}"#.to_string()
        });
        json.push('\n');

        if writer.write_all(json.as_bytes()).await.is_err() { break; }
        if writer.flush().await.is_err() { break; }
    }
}

fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}

/// Generate JS that auto-waits for an element to be visible + enabled, then runs an action.
/// The action_body has access to `el` (the found element).
fn action_js(selector: &str, timeout_ms: u64, action_body: &str) -> String {
    let s = json_str(selector);
    format!(
        r#"(async function(){{ var dl=Date.now()+{t}; while(Date.now()<dl){{ var el=document.querySelector({s}); if(el){{ var r=el.getBoundingClientRect(); var st=getComputedStyle(el); if(r.width>0&&r.height>0&&st.visibility!=='hidden'&&st.display!=='none'&&parseFloat(st.opacity)>0){{ {action}; }} }} await new Promise(function(r){{setTimeout(r,50)}}); }} throw new Error('timeout ('+{t}+'ms) waiting for '+{s}); }})()"#,
        s=s, t=timeout_ms, action=action_body
    )
}

/// Generate JS that auto-waits for an element to exist, then returns a value.
/// The return_expr has access to `el` (the found element).
fn query_js(selector: &str, timeout_ms: u64, return_expr: &str) -> String {
    let s = json_str(selector);
    format!(
        r#"(async function(){{ var dl=Date.now()+{t}; while(Date.now()<dl){{ var el=document.querySelector({s}); if(el){{ return {ret}; }} await new Promise(function(r){{setTimeout(r,50)}}); }} throw new Error('timeout ('+{t}+'ms) waiting for '+{s}); }})()"#,
        s=s, t=timeout_ms, ret=return_expr
    )
}

async fn execute_command<R: Runtime>(
    app: &Arc<AppHandle<R>>,
    pending: &PendingResults,
    recording: &RecordingState,
    window_label: &str,
    cmd: Command,
) -> Response {
    match cmd {
        Command::Ping => Response::ok(serde_json::json!("pong")),
        Command::Eval { script } => eval_js(app, pending, window_label, &script).await,

        // ── Actions (auto-wait for visible + enabled) ─────────────────

        Command::Click { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms,
                "el.scrollIntoView({block:'center'}); el.click(); return null"
            )).await
        }
        Command::Dblclick { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms,
                "el.scrollIntoView({block:'center'}); el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return null"
            )).await
        }
        Command::Hover { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms,
                "el.scrollIntoView({block:'center'}); var r2=el.getBoundingClientRect(); var cx=r2.left+r2.width/2; var cy=r2.top+r2.height/2; el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true,clientX:cx,clientY:cy})); el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:cx,clientY:cy})); return null"
            )).await
        }
        Command::Fill { selector, text, timeout_ms } => {
            let t = json_str(&text);
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms, &format!(
                "el.focus(); var desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value'); if(desc&&desc.set) desc.set.call(el,{t}); else el.value={t}; el.dispatchEvent(new Event('input',{{bubbles:true}})); el.dispatchEvent(new Event('change',{{bubbles:true}})); return null", t=t
            ))).await
        }
        Command::TypeText { selector, text, timeout_ms } => {
            let t = json_str(&text);
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms, &format!(
                "el.focus(); for(var i=0;i<{t}.length;i++){{ var ch={t}[i]; el.dispatchEvent(new KeyboardEvent('keydown',{{key:ch,bubbles:true}})); var desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value'); if(desc&&desc.set) desc.set.call(el,el.value+ch); else el.value+=ch; el.dispatchEvent(new Event('input',{{bubbles:true}})); el.dispatchEvent(new KeyboardEvent('keyup',{{key:ch,bubbles:true}})); }} return null", t=t
            ))).await
        }
        Command::Press { selector, key, timeout_ms } => {
            let k = json_str(&key);
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms, &format!(
                "el.focus(); var o={{key:{k},bubbles:true}}; el.dispatchEvent(new KeyboardEvent('keydown',o)); el.dispatchEvent(new KeyboardEvent('keypress',o)); el.dispatchEvent(new KeyboardEvent('keyup',o)); return null", k=k
            ))).await
        }
        Command::Check { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms,
                "if(!el.checked){ el.click(); } return null"
            )).await
        }
        Command::Uncheck { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms,
                "if(el.checked){ el.click(); } return null"
            )).await
        }
        Command::SelectOption { selector, value, timeout_ms } => {
            let v = json_str(&value);
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms, &format!(
                "el.value={v}; el.dispatchEvent(new Event('change',{{bubbles:true}})); return el.value", v=v
            ))).await
        }
        Command::Focus { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms,
                "(function(){ el.focus(); return null; })()"
            )).await
        }
        Command::Blur { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms,
                "(function(){ el.blur(); return null; })()"
            )).await
        }
        Command::DragAndDrop { source, target, timeout_ms } => {
            let src = json_str(&source);
            let tgt = json_str(&target);
            eval_js(app, pending, window_label, &format!(
                r#"(async function(){{
                    var dl=Date.now()+{t};
                    while(Date.now()<dl){{
                        var s=document.querySelector({src}); var t=document.querySelector({tgt});
                        if(s&&t){{
                            s.scrollIntoView({{block:'center'}});
                            var sr=s.getBoundingClientRect(); var tr=t.getBoundingClientRect();
                            var sx=sr.left+sr.width/2,sy=sr.top+sr.height/2;
                            var tx=tr.left+tr.width/2,ty=tr.top+tr.height/2;
                            var dt=new DataTransfer();
                            s.dispatchEvent(new DragEvent('dragstart',{{bubbles:true,clientX:sx,clientY:sy,dataTransfer:dt}}));
                            s.dispatchEvent(new DragEvent('drag',{{bubbles:true,clientX:sx,clientY:sy,dataTransfer:dt}}));
                            t.dispatchEvent(new DragEvent('dragenter',{{bubbles:true,clientX:tx,clientY:ty,dataTransfer:dt}}));
                            t.dispatchEvent(new DragEvent('dragover',{{bubbles:true,clientX:tx,clientY:ty,dataTransfer:dt}}));
                            t.dispatchEvent(new DragEvent('drop',{{bubbles:true,clientX:tx,clientY:ty,dataTransfer:dt}}));
                            s.dispatchEvent(new DragEvent('dragend',{{bubbles:true,clientX:tx,clientY:ty,dataTransfer:dt}}));
                            return null;
                        }}
                        await new Promise(function(r){{setTimeout(r,50)}});
                    }}
                    throw new Error('timeout waiting for drag source/target');
                }})()"#, src=src, tgt=tgt, t=timeout_ms
            )).await
        }
        Command::SetInputFiles { selector, files, timeout_ms } => {
            let files_json: Vec<String> = files.iter().map(|f| {
                format!(r#"{{"name":{},"mime":{},"b64":{}}}"#,
                    json_str(&f.name), json_str(&f.mime_type), json_str(&f.base64))
            }).collect();
            let arr = format!("[{}]", files_json.join(","));
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms, &format!(
                r#"(function(){{ var files={arr}; var dt=new DataTransfer(); for(var i=0;i<files.length;i++){{ var f=files[i]; var bin=atob(f.b64); var bytes=new Uint8Array(bin.length); for(var j=0;j<bin.length;j++) bytes[j]=bin.charCodeAt(j); dt.items.add(new File([bytes],f.name,{{type:f.mime}})); }} el.files=dt.files; el.dispatchEvent(new Event('change',{{bubbles:true}})); return el.files.length; }})()"#, arr=arr
            ))).await
        }

        // ── Queries (auto-wait for element to exist) ──────────────────

        Command::TextContent { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms, "el.textContent")).await
        }
        Command::InnerHtml { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms, "el.innerHTML")).await
        }
        Command::InnerText { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms, "el.innerText")).await
        }
        Command::GetAttribute { selector, name, timeout_ms } => {
            let n = json_str(&name);
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms, &format!("el.getAttribute({n})", n=n))).await
        }
        Command::InputValue { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms, "el.value||''")).await
        }
        Command::BoundingBox { selector, timeout_ms } => {
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms,
                "(function(){ var r2=el.getBoundingClientRect(); return {x:r2.left,y:r2.top,width:r2.width,height:r2.height}; })()"
            )).await
        }

        // ── State checks (instant, no retry) ──────────────────────────

        Command::IsVisible { selector } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(
                r#"(function(){{ var el=document.querySelector({s}); if(!el) return false; var r=el.getBoundingClientRect(); var st=getComputedStyle(el); return r.width>0&&r.height>0&&st.visibility!=='hidden'&&st.display!=='none'&&parseFloat(st.opacity)>0; }})()"#, s=s
            )).await
        }
        Command::IsChecked { selector } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(
                r#"(function(){{ var el=document.querySelector({s}); if(!el) return false; return !!el.checked; }})()"#, s=s
            )).await
        }
        Command::IsDisabled { selector } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(
                r#"(function(){{ var el=document.querySelector({s}); if(!el) return true; return el.disabled===true||el.hasAttribute('disabled'); }})()"#, s=s
            )).await
        }
        Command::IsEditable { selector } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(
                r#"(function(){{ var el=document.querySelector({s}); if(!el) return false; if(el.disabled||el.readOnly) return false; var tag=el.tagName; return tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||el.isContentEditable; }})()"#, s=s
            )).await
        }

        // ── Bulk queries (no retry, work on zero matches) ─────────────

        Command::AllTextContents { selector } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(
                r#"Array.from(document.querySelectorAll({s})).map(function(el){{ return el.textContent||''; }})"#, s=s
            )).await
        }
        Command::AllInnerTexts { selector } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(
                r#"Array.from(document.querySelectorAll({s})).map(function(el){{ return el.innerText||''; }})"#, s=s
            )).await
        }
        Command::Count { selector } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(r#"document.querySelectorAll({s}).length"#, s=s)).await
        }

        // ── Waiting ───────────────────────────────────────────────────

        Command::WaitForSelector { selector, timeout_ms } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(
                r#"(async function(){{ var dl=Date.now()+{t}; while(Date.now()<dl){{ var el=document.querySelector({s}); if(el){{ var r=el.getBoundingClientRect(); var st=getComputedStyle(el); if(r.width>0&&r.height>0&&st.visibility!=='hidden'&&st.display!=='none') return true; }} await new Promise(function(r){{setTimeout(r,50)}}); }} throw new Error('timeout waiting for '+{s}); }})()"#,
                s=s, t=timeout_ms
            )).await
        }
        Command::WaitForFunction { expression, timeout_ms } => {
            let e = json_str(&expression);
            eval_js(app, pending, window_label, &format!(
                r#"(async function(){{ var dl=Date.now()+{t}; while(Date.now()<dl){{ try{{ var r=({expr}); if(r) return r; }}catch(ex){{}} await new Promise(function(r){{setTimeout(r,100)}}); }} throw new Error('waitForFunction timeout: '+{e}); }})()"#,
                expr=expression, e=e, t=timeout_ms
            )).await
        }
        Command::Content => {
            eval_js(app, pending, window_label, "document.documentElement.outerHTML").await
        }
        Command::InstallDialogHandler { default_confirm, default_prompt_text } => {
            let confirm_val = if default_confirm { "true" } else { "false" };
            let prompt_val = match &default_prompt_text {
                Some(t) => json_str(t),
                None => "null".to_string(),
            };
            eval_js(app, pending, window_label, &format!(
                r#"(function(){{
                    window.__pw_dialogs=window.__pw_dialogs||[];
                    window.__pw_confirm_val={cv};
                    window.__pw_prompt_val={pv};
                    window.alert=function(m){{ window.__pw_dialogs.push({{type:'alert',message:String(m)}}); }};
                    window.confirm=function(m){{ window.__pw_dialogs.push({{type:'confirm',message:String(m)}}); return window.__pw_confirm_val; }};
                    window.prompt=function(m,d){{ window.__pw_dialogs.push({{type:'prompt',message:String(m),default:d||''}}); return window.__pw_prompt_val; }};
                    return true;
                }})()"#, cv=confirm_val, pv=prompt_val
            )).await
        }
        Command::GetDialogs => {
            eval_js(app, pending, window_label, "window.__pw_dialogs||[]").await
        }
        Command::ClearDialogs => {
            eval_js(app, pending, window_label, "(function(){ window.__pw_dialogs=[]; return null; })()").await
        }
        Command::AddNetworkRoute { pattern, status, body, content_type } => {
            let p = json_str(&pattern);
            let b = json_str(&body);
            let ct = json_str(content_type.as_deref().unwrap_or("application/json"));
            eval_js(app, pending, window_label, &format!(
                r#"(function(){{
                    if(!window.__pw_routes){{
                        window.__pw_routes=[];
                        window.__pw_net_requests=[];
                        var origFetch=window.fetch;
                        window.fetch=function(input,init){{
                            var url=typeof input==='string'?input:(input&&input.url?input.url:'');
                            var method=(init&&init.method)||'GET';
                            window.__pw_net_requests.push({{url:url,method:method,timestamp:Date.now()}});
                            for(var i=0;i<window.__pw_routes.length;i++){{
                                var r=window.__pw_routes[i];
                                if(url.includes(r.pattern)||new RegExp(r.pattern).test(url)){{
                                    return Promise.resolve(new Response(r.body,{{status:r.status,headers:{{'Content-Type':r.ct}}}}));
                                }}
                            }}
                            return origFetch.apply(this,arguments);
                        }};
                        var origOpen=XMLHttpRequest.prototype.open;
                        var origSend=XMLHttpRequest.prototype.send;
                        XMLHttpRequest.prototype.open=function(m,u){{
                            this.__pw_method=m;this.__pw_url=u;
                            return origOpen.apply(this,arguments);
                        }};
                        XMLHttpRequest.prototype.send=function(){{
                            var self=this;
                            window.__pw_net_requests.push({{url:self.__pw_url,method:self.__pw_method,timestamp:Date.now()}});
                            for(var i=0;i<window.__pw_routes.length;i++){{
                                var r=window.__pw_routes[i];
                                if(self.__pw_url&&(self.__pw_url.includes(r.pattern)||new RegExp(r.pattern).test(self.__pw_url))){{
                                    Object.defineProperty(self,'status',{{get:function(){{return r.status}}}});
                                    Object.defineProperty(self,'responseText',{{get:function(){{return r.body}}}});
                                    Object.defineProperty(self,'response',{{get:function(){{return r.body}}}});
                                    Object.defineProperty(self,'readyState',{{get:function(){{return 4}}}});
                                    setTimeout(function(){{self.onreadystatechange&&self.onreadystatechange();self.onload&&self.onload();}},0);
                                    return;
                                }}
                            }}
                            return origSend.apply(this,arguments);
                        }};
                    }}
                    window.__pw_routes.push({{pattern:{p},status:{st},body:{b},ct:{ct}}});
                    return window.__pw_routes.length;
                }})()"#, p=p, st=status, b=b, ct=ct
            )).await
        }
        Command::RemoveNetworkRoute { pattern } => {
            let p = json_str(&pattern);
            eval_js(app, pending, window_label, &format!(
                r#"(function(){{ if(!window.__pw_routes) return 0; window.__pw_routes=window.__pw_routes.filter(function(r){{return r.pattern!=={p}}}); return window.__pw_routes.length; }})()"#, p=p
            )).await
        }
        Command::ClearNetworkRoutes => {
            eval_js(app, pending, window_label, "(function(){ window.__pw_routes=[]; return null; })()").await
        }
        Command::GetNetworkRequests => {
            eval_js(app, pending, window_label, "window.__pw_net_requests||[]").await
        }
        Command::ClearNetworkRequests => {
            eval_js(app, pending, window_label, "(function(){ window.__pw_net_requests=[]; return null; })()").await
        }
        Command::DispatchEvent { selector, event_type, timeout_ms } => {
            let e = json_str(&event_type);
            eval_js(app, pending, window_label, &action_js(&selector, timeout_ms, &format!(
                "el.dispatchEvent(new Event({e},{{bubbles:true}})); return null", e=e
            ))).await
        }
        Command::GetComputedStyle { selector, property, timeout_ms } => {
            let p = json_str(&property);
            eval_js(app, pending, window_label, &query_js(&selector, timeout_ms, &format!(
                "getComputedStyle(el).getPropertyValue({p})", p=p
            ))).await
        }
        Command::IsFocused { selector } => {
            let s = json_str(&selector);
            eval_js(app, pending, window_label, &format!(
                r#"(function(){{ var el=document.querySelector({s}); return el!==null&&document.activeElement===el; }})()"#, s=s
            )).await
        }
        Command::Title => eval_js(app, pending, window_label, "document.title").await,
        Command::Url => eval_js(app, pending, window_label, "window.location.href").await,
        Command::Goto { url } => {
            let u = json_str(&url);
            eval_js(app, pending, window_label, &format!(r#"(function(){{ window.location.href={u}; return null; }})()"#, u=u)).await
        }
        Command::Reload => {
            eval_js(app, pending, window_label, "(function(){ window.location.reload(); return null; })()").await
        }
        Command::GoBack => {
            eval_js(app, pending, window_label, "(function(){ window.history.back(); return null; })()").await
        }
        Command::GoForward => {
            eval_js(app, pending, window_label, "(function(){ window.history.forward(); return null; })()").await
        }
        Command::WaitForUrl { pattern, timeout_ms } => {
            let p = json_str(&pattern);
            eval_js(app, pending, window_label, &format!(
                r#"(async function(){{ var dl=Date.now()+{t}; while(Date.now()<dl){{ if(window.location.href.includes({p})||new RegExp({p}).test(window.location.href)) return window.location.href; await new Promise(function(r){{setTimeout(r,100)}}); }} throw new Error('timeout waiting for URL matching '+{p}); }})()"#,
                p=p, t=timeout_ms
            )).await
        }
        Command::Screenshot { path } => {
            take_screenshot(app, pending, window_label, path).await
        }
        Command::NativeScreenshot { path } => {
            take_native_screenshot(app, window_label, path).await
        }
        Command::StartRecording { path, fps } => {
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (path, fps, recording);
                Response::err(
                    "video recording is not supported on this platform yet (macOS only)",
                )
            }
            #[cfg(target_os = "macos")]
            {
                let mut rec = recording.lock().await;
                if rec.is_some() {
                    return Response::err("recording already in progress");
                }
                match RecordingSession::start(path, fps) {
                    Ok(session) => {
                        let dir = session.output_dir.clone();
                        *rec = Some(session);
                        Response::ok(serde_json::json!({ "dir": dir, "fps": fps }))
                    }
                    Err(e) => Response::err(e),
                }
            }
        }
        Command::StopRecording => {
            let mut rec = recording.lock().await;
            match rec.take() {
                Some(mut session) => {
                    let fps = session.fps;
                    let (dir, frame_count) = session.stop().await;

                    // Try to stitch into video with ffmpeg
                    let video_path = format!("{}/video.mp4", dir);
                    let video = session.stitch(&video_path).await.ok();

                    Response::ok(serde_json::json!({
                        "dir": dir,
                        "frame_count": frame_count,
                        "fps": fps,
                        "video": video,
                    }))
                }
                None => Response::err("no recording in progress"),
            }
        }
        Command::ListWindows => list_windows(app).await,
    }
}

/// Enumerate all open webview windows. Returns label, current URL, title and
/// visibility for each. Test code uses this to discover newly-opened windows
/// (e.g., a viewer or settings dialog) and pin subsequent commands to them.
async fn list_windows<R: Runtime>(app: &Arc<AppHandle<R>>) -> Response {
    // Enumerate plain windows, not `webview_windows()`: a window stops being a
    // WebviewWindow the moment it hosts a second webview (a child dock), and
    // the old enumeration silently dropped it. Sorted by label so callers
    // polling with `waitForWindow` get deterministic matches.
    let mut entries: Vec<_> = app.windows().into_iter().collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut infos: Vec<WindowInfo> = Vec::new();
    for (label, window) in entries {
        let webview = window
            .webviews()
            .into_iter()
            .find(|w| w.label() == label)
            .or_else(|| window.webviews().into_iter().next());
        let url = webview
            .and_then(|w| w.url().ok())
            .map(|u| u.to_string())
            .unwrap_or_default();
        let title = window.title().unwrap_or_default();
        let visible = window.is_visible().unwrap_or(false);
        infos.push(WindowInfo { label, url, title, visible });
    }
    match serde_json::to_value(&infos) {
        Ok(v) => Response::ok(v),
        Err(e) => Response::err(format!("serialize windows: {}", e)),
    }
}

/// Inject JS into the webview via `WebviewWindow::eval()` and wait for the result
/// to come back through the Tauri IPC `pw_result` command.
async fn eval_js<R: Runtime>(
    app: &Arc<AppHandle<R>>,
    pending: &PendingResults,
    window_label: &str,
    script: &str,
) -> Response {
    let id = format!("pw{}", COUNTER.fetch_add(1, Ordering::SeqCst));

    let (tx, rx) = oneshot::channel::<String>();
    pending.lock().await.insert(id.clone(), tx);

    // Wrap the user script in a try-catch that sends the result back via Tauri IPC.
    // The id is JSON-escaped to prevent injection if the format ever changes.
    let id_json = serde_json::to_string(&id).unwrap();
    let wrapped_script = format!(
        r#"(async () => {{
  const __pw_id = {id_json};
  try {{
    const __pw_result = await ({script});
    window.__TAURI_INTERNALS__.invoke('plugin:playwright|pw_result',
      {{ id: __pw_id, ok: true, data: JSON.stringify(__pw_result) }});
  }} catch(e) {{
    window.__TAURI_INTERNALS__.invoke('plugin:playwright|pw_result',
      {{ id: __pw_id, ok: false, error: String(e && e.message || e) }});
  }}
}})()"#,
        script = script,
        id_json = id_json,
    );

    // Resolve the webview through its host window, retrying briefly if it's
    // not ready yet. Going through `get_webview_window` would fail as soon as
    // the window hosts a second webview (a child dock).
    let resolve = |app: &AppHandle<R>| -> Option<Webview<R>> {
        let window = app.get_window(window_label)?;
        window
            .webviews()
            .into_iter()
            .find(|w| w.label() == window_label)
            .or_else(|| window.webviews().into_iter().next())
    };
    let webview: Webview<R> = {
        let mut attempts = 0;
        loop {
            if let Some(w) = resolve(app) {
                break w;
            }
            attempts += 1;
            if attempts >= 20 {
                pending.lock().await.remove(&id);
                let mut available: Vec<String> = app.windows().keys().cloned().collect();
                available.sort();
                return Response::err(format!(
                    "window '{}' not found after retries (available windows: [{}])",
                    window_label,
                    available.join(", ")
                ));
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    };

    if let Err(e) = webview.eval(&wrapped_script) {
        pending.lock().await.remove(&id);
        return Response::err(format!("eval failed: {}", e));
    }

    // Wait for the JS to execute and send the result back via IPC
    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(result_json)) => {
            match serde_json::from_str::<serde_json::Value>(&result_json) {
                Ok(v) => {
                    if v.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                        Response::ok(v.get("v").cloned())
                    } else {
                        let msg = v.get("e").and_then(|v| v.as_str()).unwrap_or("unknown JS error").to_string();
                        Response::err(msg)
                    }
                }
                Err(e) => Response::err(format!("parse error: {}", e)),
            }
        }
        Ok(Err(_)) => Response::err("channel dropped".to_string()),
        Err(_) => {
            pending.lock().await.remove(&id);
            Response::err("timeout (30s)".to_string())
        }
    }
}

/// Take a screenshot by loading html2canvas in the webview and rendering to PNG.
async fn take_screenshot<R: Runtime>(
    app: &Arc<AppHandle<R>>,
    pending: &PendingResults,
    window_label: &str,
    path: Option<String>,
) -> Response {
    let script = r#"
(async function() {
  var w = document.documentElement.scrollWidth;
  var h = document.documentElement.scrollHeight;
  var clone = document.documentElement.cloneNode(true);

  // Inline all computed styles
  var styles = '';
  try {
    for (var i = 0; i < document.styleSheets.length; i++) {
      try {
        var rules = document.styleSheets[i].cssRules || document.styleSheets[i].rules;
        if (rules) {
          for (var j = 0; j < rules.length; j++) {
            styles += rules[j].cssText + '\n';
          }
        }
      } catch(e) { /* cross-origin stylesheet, skip */ }
    }
  } catch(e) {}

  var styleEl = document.createElement('style');
  styleEl.textContent = styles;
  clone.querySelector('head').appendChild(styleEl);

  // Remove scripts from clone
  clone.querySelectorAll('script').forEach(function(s) { s.remove(); });

  var html = new XMLSerializer().serializeToString(clone);

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    '<foreignObject width="100%" height="100%">' + html + '</foreignObject></svg>';

  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');

  var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  var url = URL.createObjectURL(blob);

  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch(e) {
        reject(new Error('canvas tainted: ' + e.message));
      }
    };
    img.onerror = function() {
      URL.revokeObjectURL(url);
      reject(new Error('svg render failed'));
    };
    img.src = url;
  });
})()
"#;

    let result = eval_js(app, pending, window_label, script).await;

    if !result.ok {
        return result;
    }

    // result.data is a data:image/png;base64,... string
    if let Some(serde_json::Value::String(data_url)) = &result.data {
        if let Some(base64_data) = data_url.strip_prefix("data:image/png;base64,") {
            // If a path was provided, save the file
            if let Some(ref file_path) = path {
                match base64_decode(base64_data) {
                    Ok(bytes) => {
                        if let Err(e) = tokio::fs::write(file_path, &bytes).await {
                            return Response::err(format!("write file: {}", e));
                        }
                        return Response::ok(serde_json::json!({
                            "path": file_path,
                            "size": bytes.len()
                        }));
                    }
                    Err(e) => return Response::err(format!("base64 decode: {}", e)),
                }
            }

            // Return base64 and size
            return Response::ok(serde_json::json!({
                "base64": base64_data,
                "size": base64_data.len()
            }));
        }
    }

    Response::err("unexpected screenshot result format".to_string())
}

/// Native screenshot via platform APIs (CoreGraphics on macOS, webkit2gtk on Linux).
async fn take_native_screenshot<R: Runtime>(
    app: &Arc<AppHandle<R>>,
    window_label: &str,
    path: Option<String>,
) -> Response {
    let app = Arc::clone(app);
    let wl = window_label.to_string();
    let result = tokio::task::spawn_blocking(move || {
        crate::native_capture::platform::screenshot(&app, &wl)
    })
    .await;

    match result {
        Ok(Ok(png_bytes)) => {
            if let Some(ref file_path) = path {
                if let Err(e) = tokio::fs::write(file_path, &png_bytes).await {
                    return Response::err(format!("write file: {}", e));
                }
                Response::ok(serde_json::json!({
                    "path": file_path,
                    "size": png_bytes.len()
                }))
            } else {
                let base64 = crate::native_capture::base64_encode(&png_bytes);
                Response::ok(serde_json::json!({
                    "base64": base64,
                    "size": png_bytes.len()
                }))
            }
        }
        Ok(Err(e)) => Response::err(e),
        Err(e) => Response::err(format!("capture thread error: {}", e)),
    }
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: [u8; 256] = {
        let mut t = [255u8; 256];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            t[chars[i] as usize] = i as u8;
            i += 1;
        }
        t
    };

    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'=' && b != b'\n' && b != b'\r').collect();
    let mut result = Vec::with_capacity(bytes.len() * 3 / 4);

    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 { break; }
        let a = TABLE[chunk[0] as usize] as u32;
        let b = TABLE[chunk[1] as usize] as u32;
        let c = if chunk.len() > 2 { TABLE[chunk[2] as usize] as u32 } else { 0 };
        let d = if chunk.len() > 3 { TABLE[chunk[3] as usize] as u32 } else { 0 };

        if a == 255 || b == 255 { return Err("invalid base64".to_string()); }

        let n = (a << 18) | (b << 12) | (c << 6) | d;
        result.push((n >> 16) as u8);
        if chunk.len() > 2 && c != 255 { result.push((n >> 8) as u8); }
        if chunk.len() > 3 && d != 255 { result.push(n as u8); }
    }

    Ok(result)
}
