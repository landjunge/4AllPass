//! Additional checks in the same opt-in isolated WKWebView/ACL context.
pub(crate) fn extend(acl_script: String) -> String {
    let port: u16 = std::env::args()
        .nth(2)
        .expect("owned ephemeral listener port required")
        .parse()
        .expect("numeric port");
    assert!(port > 1024 && port != 8787 && port != 8788);
    let allow = match std::env::args().nth(3).as_deref() {
        Some("wildcard") => true,
        Some("tight") => false,
        _ => panic!("network probe requires wildcard or tight oracle"),
    };
    let network = include_str!("../tests/native-network-probe.js")
        .replace("__OWNED_PORT__", &port.to_string())
        .replace("__EXPECT_ALLOWED__", if allow { "true" } else { "false" });
    format!("{network}\n{acl_script}")
}
