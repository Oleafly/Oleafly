// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
    ffi::OsString,
    io::{BufWriter, Error, ErrorKind, Write},
    os::unix::{ffi::OsStringExt, fs::MetadataExt, net::UnixStream},
    path::{Path, PathBuf},
};

#[cfg(feature = "semver")]
use crate::semver_compat::semver_compat_string;
use crate::SingleInstanceCallback;
use tauri::{
    plugin::{self, TauriPlugin},
    AppHandle, Config, Manager, RunEvent, Runtime,
};
use tokio::io::AsyncReadExt;

pub fn init<R: Runtime>(cb: Box<SingleInstanceCallback<R>>) -> TauriPlugin<R> {
    plugin::Builder::new("single-instance")
        .setup(|app, _api| {
            let socket = socket_path(app.config(), app.package_info());

            // Notify the singleton which may or may not exist.
            match notify_singleton(&socket) {
                Ok(_) => {
                    std::process::exit(0);
                }
                Err(e) => {
                    match e.kind() {
                        ErrorKind::NotFound | ErrorKind::ConnectionRefused => {
                            // This process claims itself as singleton as likely none exists
                            socket_cleanup(&socket);
                            listen_for_other_instances(socket, app.clone(), cb);
                        }
                        _ => {
                            tracing::debug!(
                                "single_instance failed to notify - launching normally: {}",
                                e
                            );
                        }
                    }
                }
            }
            Ok(())
        })
        .on_event(|app, event| {
            if let RunEvent::Exit = event {
                destroy(app);
            }
        })
        .build()
}

pub fn destroy<R: Runtime, M: Manager<R>>(manager: &M) {
    let socket = socket_path(manager.config(), manager.package_info());
    socket_cleanup(&socket);
}

fn socket_path(config: &Config, _package_info: &tauri::PackageInfo) -> PathBuf {
    let identifier = config.identifier.replace(['.', '-'].as_ref(), "_");

    #[cfg(feature = "semver")]
    let identifier = format!(
        "{identifier}_{}",
        semver_compat_string(&_package_info.version),
    );

    let name = format!("{identifier}_si.sock");
    user_temp_dir()
        .map(|dir| dir.join(&name))
        .filter(|path| path.as_os_str().len() < SOCKET_PATH_LIMIT)
        .unwrap_or_else(|| {
            PathBuf::from(format!(
                "/tmp/{identifier}_{}_si.sock",
                unsafe { libc::geteuid() }
            ))
        })
}

const SOCKET_PATH_LIMIT: usize = 104;

fn user_temp_dir() -> Option<PathBuf> {
    let mut buffer = vec![0u8; 1024];
    let needed = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
        )
    };
    if needed == 0 || needed > buffer.len() {
        return None;
    }
    buffer.truncate(needed - 1);
    let dir = PathBuf::from(OsString::from_vec(buffer));
    dir.is_absolute().then_some(dir)
}

fn owned_by_this_user(socket: &Path) -> Result<(), Error> {
    let metadata = std::fs::symlink_metadata(socket)?;
    if metadata.uid() == unsafe { libc::geteuid() } {
        Ok(())
    } else {
        Err(Error::new(
            ErrorKind::PermissionDenied,
            "the single instance socket belongs to another user",
        ))
    }
}

fn socket_cleanup(socket: &PathBuf) {
    let _ = std::fs::remove_file(socket);
}

fn notify_singleton(socket: &PathBuf) -> Result<(), Error> {
    owned_by_this_user(socket)?;
    let stream = UnixStream::connect(socket)?;
    let mut bf = BufWriter::new(&stream);
    let cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_str()
        .unwrap_or_default()
        .to_string();
    bf.write_all(cwd.as_bytes())?;
    bf.write_all(b"\0\0")?;
    let args_joined = std::env::args().collect::<Vec<String>>().join("\0");
    bf.write_all(args_joined.as_bytes())?;
    bf.flush()?;
    drop(bf);
    Ok(())
}

fn listen_for_other_instances<A: Runtime>(
    socket: PathBuf,
    app: AppHandle<A>,
    mut cb: Box<SingleInstanceCallback<A>>,
) {
    tauri::async_runtime::spawn(async move {
        match tokio::net::UnixListener::bind(socket) {
            Ok(listener) => loop {
                match listener.accept().await {
                    Ok((mut stream, _addr)) => {
                        let mut s = String::new();
                        match stream.read_to_string(&mut s).await {
                            Ok(_) => {
                                let (cwd, args) = s.split_once("\0\0").unwrap_or_default();
                                let args: Vec<String> =
                                    args.split('\0').map(String::from).collect();
                                cb(app.app_handle(), args, cwd.to_string());
                            }
                            Err(e) => {
                                tracing::debug!("single_instance failed to be notified: {e}")
                            }
                        }
                    }
                    Err(err) => {
                        tracing::debug!("single_instance failed to be notified: {}", err);
                        continue;
                    }
                }
            },
            Err(err) => {
                tracing::error!(
                    "single_instance failed to listen to other processes - launching normally: {}",
                    err
                );
            }
        }
    });
}
