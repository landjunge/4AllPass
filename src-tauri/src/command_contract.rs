// Single source for build-time own-command permissions and runtime dispatch.
// Keep snake_case command names here; Tauri generates kebab-case permission IDs.
macro_rules! app_commands {
    ($consumer:ident) => {
        $consumer![
            prompts::access_prompt,
            prompts::access_decide,
            prompts::access_dismiss,
            sidecar_http::sidecar_http,
            browsers::list_browser_profiles,
            browsers::extension_install,
            browsers::open_browser_for_extension,
            browsers::open_autofill_demo,
            browser_passwords::import_browser_logins
        ]
    };
}
macro_rules! command_names {
    ($($module:ident::$command:ident),* $(,)?) => { &[$(stringify!($command)),*] };
}
pub const APP_COMMAND_NAMES: &[&str] = app_commands!(command_names);

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn each_registered_command_has_exactly_its_intended_window_permission() {
        let main: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let prompt: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/access-prompt.json")).unwrap();
        assert_eq!(main["windows"], serde_json::json!(["main"]));
        assert_eq!(prompt["windows"], serde_json::json!(["access-prompt"]));
        assert_eq!(
            prompt["permissions"],
            serde_json::json!(["allow-access-decide"])
        );
        let own_main: BTreeSet<_> = main["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|value| value.as_str())
            .filter(|value| value.starts_with("allow-"))
            .map(str::to_owned)
            .collect();
        let expected: BTreeSet<_> = APP_COMMAND_NAMES
            .iter()
            .filter(|&&name| name != "access_decide")
            .map(|name| format!("allow-{}", name.replace('_', "-")))
            .collect();
        assert_eq!(own_main, expected);
        assert_eq!(APP_COMMAND_NAMES.len(), 9);
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["app"]["security"]["capabilities"],
            serde_json::json!(["default", "access-prompt"])
        );
    }
}
