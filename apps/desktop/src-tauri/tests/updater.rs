use synapse_desktop::updater::update_manifest_url;

#[test]
fn update_feed_is_scoped_to_the_connected_https_instance() {
    assert_eq!(
        update_manifest_url("https://notes.example.test").unwrap(),
        "https://notes.example.test/updates/stable/latest.json"
    );
    assert!(update_manifest_url("https://notes.example.test/base").is_err());
    assert!(update_manifest_url("http://notes.example.test").is_err());
    assert!(update_manifest_url("https://user:password@notes.example.test").is_err());
}

#[test]
fn update_feed_allows_only_explicit_loopback_http_for_development() {
    assert!(update_manifest_url("http://127.0.0.1:3000").is_ok());
    assert!(update_manifest_url("http://localhost:3000").is_ok());
    assert!(update_manifest_url("http://192.168.1.10:3000").is_err());
}
