use super::*;
use crate::test_http_fixture::{Reply, Server};
use std::io::Read;

const SYNTHETIC_KEY: &str = "synthetic-test-bearer-value-not-a-real-credential-000111222";

fn base(server: &Server) -> String {
    format!("http://{}", server.address)
}

#[test]
fn ok_200_is_valid() {
    let server = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "{}",
    });
    let (status, scope) = check_against(CheckedProvider::OpenAi, SYNTHETIC_KEY, &base(&server));
    assert_eq!(status, KeyCheckStatus::Valid);
    assert_eq!(scope, None);
    assert_eq!(server.count(), 1);
}

#[test]
fn github_200_without_a_scope_header_claims_no_scope() {
    let server = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "{}",
    });
    // The fixture server cannot set response headers today (it only varies
    // status/body/location), so this asserts the no-header branch: no scope
    // claimed when the provider sends none. The Authorization header itself
    // is sent regardless — that is the request transport, not a log.
    let (status, scope) = check_against(CheckedProvider::GitHub, SYNTHETIC_KEY, &base(&server));
    assert_eq!(status, KeyCheckStatus::Valid);
    assert_eq!(scope, None);
}

#[test]
fn status_401_is_invalid_for_every_covered_provider() {
    for provider in [CheckedProvider::GitHub, CheckedProvider::OpenAi, CheckedProvider::Stripe] {
        let server = Server::start(|_| Reply {
            status: 401,
            location: None,
            body: "synthetic unauthorized",
        });
        let (status, _) = check_against(provider, SYNTHETIC_KEY, &base(&server));
        assert_eq!(status, KeyCheckStatus::Invalid, "{provider:?}");
    }
}

#[test]
fn status_403_without_rate_limit_signal_is_insufficient_permission_not_invalid() {
    for provider in [CheckedProvider::GitHub, CheckedProvider::OpenAi, CheckedProvider::Stripe] {
        let server = Server::start(|_| Reply {
            status: 403,
            location: None,
            body: "synthetic forbidden",
        });
        let (status, _) = check_against(provider, SYNTHETIC_KEY, &base(&server));
        assert_eq!(status, KeyCheckStatus::InsufficientPermission, "{provider:?}");
        assert_ne!(status, KeyCheckStatus::Invalid);
    }
}

#[test]
fn status_429_is_quota_exceeded_not_invalid() {
    for provider in [CheckedProvider::GitHub, CheckedProvider::OpenAi, CheckedProvider::Stripe] {
        let server = Server::start(|_| Reply {
            status: 429,
            location: None,
            body: "synthetic rate limited",
        });
        let (status, _) = check_against(provider, SYNTHETIC_KEY, &base(&server));
        assert_eq!(status, KeyCheckStatus::QuotaExceeded, "{provider:?}");
        assert_ne!(status, KeyCheckStatus::Invalid);
    }
}

#[test]
fn status_5xx_is_unreachable_not_invalid() {
    for code in [500, 502, 503] {
        let server = Server::start(move |_| Reply {
            status: code,
            location: None,
            body: "synthetic server error",
        });
        let (status, _) = check_against(CheckedProvider::GitHub, SYNTHETIC_KEY, &base(&server));
        assert_eq!(status, KeyCheckStatus::Unreachable, "{code}");
        assert_ne!(status, KeyCheckStatus::Invalid);
    }
}

#[test]
fn status_404_is_not_checkable_not_invalid() {
    let server = Server::start(|_| Reply {
        status: 404,
        location: None,
        body: "synthetic not found",
    });
    let (status, _) = check_against(CheckedProvider::Stripe, SYNTHETIC_KEY, &base(&server));
    assert_eq!(status, KeyCheckStatus::NotCheckable);
    assert_ne!(status, KeyCheckStatus::Invalid);
}

#[test]
fn redirect_is_never_followed_and_is_not_checkable() {
    let destination = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "unexpected destination",
    });
    let target = format!("http://{}/user", destination.address);
    let source = Server::start(move |_| Reply {
        status: 302,
        location: Some(target.clone()),
        body: "synthetic redirect",
    });
    let (status, scope) = check_against(CheckedProvider::GitHub, SYNTHETIC_KEY, &base(&source));
    assert_eq!(status, KeyCheckStatus::NotCheckable);
    assert_eq!(scope, None);
    assert_eq!(
        destination.count(),
        0,
        "the key must never reach a redirected/foreign host"
    );
}

#[test]
fn transport_failure_is_unreachable() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener); // nothing is listening: connection refused
    let (status, _) = check_against(CheckedProvider::OpenAi, SYNTHETIC_KEY, &format!("http://127.0.0.1:{port}"));
    assert_eq!(status, KeyCheckStatus::Unreachable);
}

#[test]
fn real_timeout_is_unreachable_not_invalid() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let _handle = std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            std::thread::sleep(Duration::from_secs(20));
        }
    });
    let started = std::time::Instant::now();
    let (status, _) = check_against(CheckedProvider::Stripe, SYNTHETIC_KEY, &format!("http://127.0.0.1:{port}"));
    assert_eq!(status, KeyCheckStatus::Unreachable);
    assert!(started.elapsed() < Duration::from_secs(15), "timeout must stay bounded");
}

#[test]
fn unknown_provider_id_is_not_checkable_without_any_network_call() {
    let server = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "unexpected call",
    });
    let outcomes = check_provider_keys(vec![KeyCheckRequest {
        id: "entry-1".into(),
        provider_id: "deepseek".into(),
        key: SYNTHETIC_KEY.into(),
    }]);
    assert_eq!(outcomes.len(), 1);
    assert_eq!(outcomes[0].status, KeyCheckStatus::NotCheckable);
    assert_eq!(server.count(), 0, "an unsupported provider id must never trigger a network call");
}

#[test]
fn empty_key_is_not_checkable_without_any_network_call() {
    let server = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "unexpected call",
    });
    let outcomes = check_provider_keys(vec![KeyCheckRequest {
        id: "entry-2".into(),
        provider_id: "github".into(),
        key: "   ".into(),
    }]);
    assert_eq!(outcomes[0].status, KeyCheckStatus::NotCheckable);
    assert_eq!(server.count(), 0);
}

#[test]
fn batch_check_is_independent_per_item_and_echoes_only_ids() {
    let valid = Server::start(|_| Reply {
        status: 200,
        location: None,
        body: "{}",
    });
    let invalid = Server::start(|_| Reply {
        status: 401,
        location: None,
        body: "synthetic",
    });
    let items = vec![
        KeyCheckRequest {
            id: "entry-valid".into(),
            provider_id: "github".into(),
            key: SYNTHETIC_KEY.into(),
        },
        KeyCheckRequest {
            id: "entry-invalid".into(),
            provider_id: "openai".into(),
            key: SYNTHETIC_KEY.into(),
        },
        KeyCheckRequest {
            id: "entry-unsupported".into(),
            provider_id: "deepseek".into(),
            key: SYNTHETIC_KEY.into(),
        },
    ];
    let outcomes = run_checks(items, |provider| match provider {
        CheckedProvider::GitHub => base(&valid),
        CheckedProvider::OpenAi => base(&invalid),
        CheckedProvider::Stripe => base(&invalid),
    });
    assert_eq!(outcomes.len(), 3);
    assert_eq!(outcomes[0].id, "entry-valid");
    assert_eq!(outcomes[0].status, KeyCheckStatus::Valid);
    assert_eq!(outcomes[1].id, "entry-invalid");
    assert_eq!(outcomes[1].status, KeyCheckStatus::Invalid);
    assert_eq!(outcomes[2].id, "entry-unsupported");
    assert_eq!(outcomes[2].status, KeyCheckStatus::NotCheckable);
    for outcome in &outcomes {
        let json = serde_json::to_string(outcome).unwrap();
        assert!(!json.contains(SYNTHETIC_KEY));
    }
}

#[test]
fn scope_hint_is_truncated_defensively() {
    let long = "a".repeat(500);
    assert_eq!(truncate_scope(&long).chars().count(), MAX_SCOPE_HINT_LEN);
    assert_eq!(truncate_scope("  repo, read:user  "), "repo, read:user");
}

#[test]
fn request_never_sends_key_as_a_query_value() {
    let server = Server::start(|request| {
        // The request line (method + path) must never carry the secret; it
        // may only appear in the Authorization header line, which this
        // fixture also records but which is not the request line asserted
        // against here.
        assert!(!request.lines().next().unwrap_or("").contains(SYNTHETIC_KEY));
        Reply {
            status: 200,
            location: None,
            body: "{}",
        }
    });
    let _ = check_against(CheckedProvider::Stripe, SYNTHETIC_KEY, &base(&server));
}

#[test]
#[allow(clippy::write_literal)]
fn outcome_serializes_without_leaking_field_names_that_look_like_secrets() {
    let outcome = KeyCheckOutcome {
        id: "entry-3".into(),
        status: KeyCheckStatus::Valid,
        scope_hint: Some("repo".into()),
    };
    let json = serde_json::to_string(&outcome).unwrap();
    assert!(json.contains("\"status\":\"valid\""));
    assert!(!json.to_lowercase().contains("password"));
    assert!(!json.to_lowercase().contains("\"key\""));
}
