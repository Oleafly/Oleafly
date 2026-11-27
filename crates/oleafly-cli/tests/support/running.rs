use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};

pub struct Running {
    pub process: Child,
    pub lines: Receiver<String>,
}

impl Running {
    pub fn start(command: &mut Command) -> Running {
        let mut process = command.stdout(Stdio::piped()).spawn().unwrap();
        let stdout = process.stdout.take().unwrap();
        let (sender, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        Running { process, lines }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}
