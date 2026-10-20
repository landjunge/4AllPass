include!("src/command_contract.rs");

fn main() {
    if (std::env::var_os("CARGO_FEATURE_NATIVE_ACL_PROBE").is_some()
        || std::env::var_os("CARGO_FEATURE_NATIVE_NORMAL_JOURNEY_PROBE").is_some())
        && std::env::var("PROFILE").as_deref() == Ok("release")
    {
        panic!("native probes are excluded from release builds");
    }
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMAND_NAMES)),
    )
    .expect("build own-command ACL");
}
