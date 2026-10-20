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
                // Darwin inherits O_NONBLOCK from the listener. read_timeout
                // alone does not clear it; a delayed header must not become EOF.
                stream.set_nonblocking(false).unwrap();
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

#[cfg(test)]
mod tests {
    use super::{Reply, Server};
    use std::{
        io::{Read, Write},
        net::TcpStream,
        thread,
        time::Duration,
    };

    #[test]
    fn accepted_socket_waits_for_delayed_headers() {
        let server = Server::start(|_| Reply {
            status: 200,
            location: None,
            body: "synthetic delayed headers",
        });
        let mut client = TcpStream::connect(server.address).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        // A nonblocking accepted socket would read WouldBlock, then close the
        // fixture connection before these deliberately delayed bytes arrive.
        thread::sleep(Duration::from_millis(30));
        client
            .write_all(b"GET /synthetic-delayed HTTP/1.1\r\nHost: fixture\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(
            response.starts_with("HTTP/1.1 200 Fixture\r\n"),
            "{response:?}"
        );
        assert!(response.ends_with("synthetic delayed headers"));
        assert_eq!(server.count(), 1);
    }
}
