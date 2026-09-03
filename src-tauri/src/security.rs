use crate::error::NativeError;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Wry;
use url::Url;

pub const EXTERNAL_HOST_ALLOWLIST: &[&str] = &["github.com"];

pub fn validate_external_url(value: &str) -> Result<Url, NativeError> {
    let url = Url::parse(value).map_err(|_| {
        NativeError::new(
            "external_url_invalid",
            "The external reference is not a valid URL.",
        )
    })?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if url.scheme() != "https"
        || !EXTERNAL_HOST_ALLOWLIST.contains(&host.as_str())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(NativeError::new(
            "external_url_rejected",
            "The external reference is outside the approved HTTPS host policy.",
        ));
    }
    Ok(url)
}

pub fn is_application_navigation(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

pub fn navigation_policy_plugin() -> TauriPlugin<Wry> {
    Builder::new("bibleapp-navigation-policy")
        .on_navigation(|_webview, url| is_application_navigation(url))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_urls_require_https_and_the_exact_host() {
        assert!(
            validate_external_url("https://github.com/Nobodyworld/app-bible-language-study")
                .is_ok()
        );
        for rejected in [
            "http://github.com/Nobodyworld/app-bible-language-study",
            "https://evil.example/",
            "https://github.com.evil.example/",
            "file:///C:/owner/data.json",
            "javascript:alert(1)",
            "data:text/plain,hello",
            "https://user@github.com/",
            "https://github.com:8443/",
        ] {
            assert!(validate_external_url(rejected).is_err(), "{rejected}");
        }
    }

    #[test]
    fn top_level_navigation_stays_inside_the_application_origin() {
        assert!(is_application_navigation(
            &Url::parse("http://tauri.localhost/index.html#/home").unwrap()
        ));
        assert!(is_application_navigation(
            &Url::parse("tauri://localhost/index.html").unwrap()
        ));
        assert!(!is_application_navigation(
            &Url::parse("https://github.com/Nobodyworld/app-bible-language-study").unwrap()
        ));
    }
}
