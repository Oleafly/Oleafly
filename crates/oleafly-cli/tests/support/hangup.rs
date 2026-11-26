use std::process::Command;

pub fn set_hangup(command: &mut Command, disposition: libc::sighandler_t) {
    use std::os::unix::process::CommandExt;
    // SAFETY: the hook only calls signal(2), which is async-signal-safe, between fork and exec.
    unsafe {
        command.pre_exec(move || {
            if libc::signal(libc::SIGHUP, disposition) == libc::SIG_ERR {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
}
