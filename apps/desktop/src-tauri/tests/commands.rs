use synapse_desktop::{commands::VaultCommands, http::SynapseRequest};

#[tokio::test]
async fn bridge_refuses_requests_until_an_instance_is_configured() {
    let commands = VaultCommands::new();

    let error = commands
        .synapse_request(SynapseRequest::Session)
        .await
        .expect_err("an unconfigured webview cannot make network requests");

    assert_eq!(error, "instance url is not configured");
}

#[test]
fn bridge_only_accepts_https_or_a_local_development_instance() {
    let commands = VaultCommands::new();

    assert_eq!(
        commands
            .set_instance_url("https://synapse.example.test".to_owned())
            .expect("https is allowed"),
        "https://synapse.example.test"
    );
    assert!(
        commands
            .set_instance_url("http://synapse.example.test".to_owned())
            .is_err()
    );
    assert!(
        commands
            .set_instance_url("http://127.0.0.1:3000".to_owned())
            .is_ok()
    );
}
