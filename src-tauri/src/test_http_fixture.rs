//! Owned loopback listeners for synthetic transport unit tests only.
use std::{
    io::{BufRead, BufReader, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

pub(crate) struct Reply {
    pub status: u16,
    pub location: Option<String>,
    pub body: &'static str,
}

pub(crate) struct Server {
    pub address: SocketAddr,
    pub requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Server {
    pub fn start(reply: impl Fn(&str) -> Reply + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        assert!(![8787, 8788].contains(&address.port()));
        listener.set_nonblocking(true).unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let done = stop.clone();
        let thread = thread::spawn(move || {
            while !done.load(Ordering::SeqCst) {
                let Ok((mut stream, _)) = listener.accept() else {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let end = line == "\r\n";
                            request.push_str(&line);
                            if end {
                                break;
                            }
                        }
                    }
                }
                if request.is_empty() {
                    continue;
                }
                let response = reply(&request);
                seen.lock().unwrap().push(request);
                let location = response
                    .location
                    .map(|v| format!("Location: {v}\r\n"))
                    .unwrap_or_default();
                let body = if response.status == 204 {
                    ""
                } else {
                    response.body
                };
                let _ = write!(stream, "HTTP/1.1 {} Fixture\r\n{location}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", response.status, body.len());
            }
        });
        Self {
            address,
            requests,
            stop,
            thread: Some(thread),
        }
    }

    pub fn count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake only our own ephemeral listener; no production-port probe.
        let _ = TcpStream::connect(self.address);
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}
