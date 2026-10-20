use super::*;
use crate::test_http_fixture::{Reply, Server};

fn get(port: u16, path: &str) -> SidecarHttpResult {
    request_core(port, "GET".into(), path.into(), HashMap::new(), None).unwrap()
}

#[test]
fn redirects_never_reach_another_loopback_listener() {
    let destination = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "unexpected destination",
    });
    let target = format!("http://{}/outside-api", destination.address);
    let source = Server::start(move |request| {
        let path = request.split_whitespace().nth(1).unwrap();
        let status = path.rsplit('/').next().unwrap().parse().unwrap();
        Reply {
            status,
            location: Some(target.clone()),
            body: "synthetic redirect",
        }
    });
    for method in ["GET", "POST"] {
        for code in [301, 302, 303, 307, 308] {
            let headers = HashMap::from([
                ("Authorization".into(), "Bearer synthetic-h2-fixture".into()),
                ("X-Device-Id".into(), "synthetic-h2-device".into()),
            ]);
            let result = request_core(
                source.address.port(),
                method.into(),
                format!("/api/v1/{code}"),
                headers,
                (method == "POST").then(|| "synthetic body".into()),
            )
            .unwrap();
            assert_eq!(result.status, code);
            assert_eq!(result.body, "synthetic redirect");
            assert_eq!(
                destination.count(),
                0,
                "no second-listener request or header disclosure"
            );
        }
    }
    assert_eq!(source.count(), 10);
    assert_eq!(destination.count(), 0);
}

#[test]
fn relative_redirect_does_not_escape_api_path() {
    let source = Server::start(|request| {
        if request.starts_with("GET /api/v1/redirect ") {
            Reply {
                status: 302,
                location: Some("/outside-api".into()),
                body: "synthetic relative redirect",
            }
        } else {
            Reply {
                status: 200,
                location: None,
                body: "unexpected relative destination",
            }
        }
    });
    let result = get(source.address.port(), "/api/v1/redirect");
    assert_eq!(result.status, 302);
    assert_eq!(source.count(), 1);
}

#[test]
fn success_no_content_and_error_statuses_are_preserved() {
    let source = Server::start(|request| Reply {
        status: request
            .split_whitespace()
            .nth(1)
            .unwrap()
            .rsplit('/')
            .next()
            .unwrap()
            .parse()
            .unwrap(),
        location: None,
        body: "synthetic response",
    });
    for code in [200, 204, 401] {
        let result = get(source.address.port(), &format!("/api/v1/{code}"));
        assert_eq!(result.status, code);
        assert_eq!(
            result.body,
            if code == 204 {
                ""
            } else {
                "synthetic response"
            }
        );
    }
    assert_eq!(source.count(), 3);
}

#[test]
fn invalid_path_or_method_never_connects() {
    let source = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "unexpected request",
    });
    for path in [
        "/outside-api",
        "/api/v1bad",
        "/api/v1/bad path",
        "/api/v1/\n",
        "/api/v1/\r",
    ] {
        assert!(request_core(
            source.address.port(),
            "GET".into(),
            path.into(),
            HashMap::new(),
            None
        )
        .is_err());
    }
    assert!(request_core(
        source.address.port(),
        "TRACE".into(),
        "/api/v1/ok".into(),
        HashMap::new(),
        None
    )
    .is_err());
    assert_eq!(source.count(), 0);
}

#[test]
fn raw_and_encoded_path_escapes_never_connect() {
    let destination = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "unexpected second listener",
    });
    let source = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "unexpected target",
    });
    for path in [
        "/api/v1/../../outside-api",
        "/api/v1/%2e%2e/%2E%2E/outside-api",
        "/api/v1/.%2e/../outside-api",
        "/api/v1/%2e./../outside-api",
        "/api/v1/%2f..%2f..%2foutside-api",
        "/api/v1/%5C..%5c..",
        "/api/v1/..\\..\\outside-api",
        "/api/v1/ok#fragment",
        "/api/v1?x=1#fragment",
        "/api/v1.evil/items",
        "/api/v10/items",
        "/other/api/v1/items",
        "http://127.0.0.1:8788/api/v1/items",
        "//foreign.invalid/api/v1/items",
        "/api/v1/\t../outside-api",
    ] {
        assert!(
            request_core(
                source.address.port(),
                "GET".into(),
                path.into(),
                HashMap::new(),
                None
            )
            .is_err(),
            "{path}"
        );
    }
    assert_eq!(source.count(), 0);
    let foreign = format!("http://{}/api/v1/items", destination.address);
    assert!(request_core(
        source.address.port(),
        "GET".into(),
        foreign,
        HashMap::new(),
        None
    )
    .is_err());
    assert_eq!(destination.count(), 0);
}

#[test]
fn ordinary_api_credentials_and_query_values_remain_supported() {
    let destination = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "unexpected query destination",
    });
    let source = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "synthetic",
    });
    let paths = [
        "/api/v1", "/api/v1?synthetic=true", "/api/v1/vaults?limit=10&offset=0",
        "/api/v1/vaults/00000000-0000-0000-0000-000000000001/devices/dev_fixture/credentials/ab-CD_ef/device-key-envelope?expectedRevision=7",
        "/api/v1/items/a%20b%2Bc%3D%25%E2%82%AC",
        "/api/v1/items?returnTo=https://synthetic.invalid/%2f%5C%23&value=../outside-api",
        "/api/v1/items/dot.name", "/api/v1/items/%252f-data",
    ];
    for path in paths {
        assert_eq!(get(source.address.port(), path).status, 200, "{path}");
    }
    let requests = source.requests.lock().unwrap();
    assert_eq!(requests.len(), paths.len());
    for (request, path) in requests.iter().zip(paths) {
        assert!(
            request.starts_with(&format!("GET {path} HTTP/1.1\r\n")),
            "{request}"
        );
    }
    drop(requests);
    let query = format!(
        "/api/v1/vaults?returnTo=http://{}/outside-api",
        destination.address
    );
    assert_eq!(get(source.address.port(), &query).status, 200);
    assert_eq!(source.count(), paths.len() + 1);
    assert_eq!(destination.count(), 0);
}
