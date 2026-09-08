use synapse_desktop::{
    commands::VaultCommands,
    http::{InstanceClient, SynapseRequest},
};

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

#[tokio::test]
async fn bridge_retries_a_transient_instance_disconnect() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener binds");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let (first, _) = listener.accept().await.expect("first connection");
        drop(first);
        let (mut second, _) = listener.accept().await.expect("retry connection");
        use tokio::io::AsyncWriteExt;
        second
            .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
            .await
            .expect("response writes");
    });

    let client =
        InstanceClient::connect(&format!("http://{address}")).expect("local instance is allowed");
    let request: SynapseRequest = serde_json::from_value(serde_json::json!({
        "kind": "login",
        "body": { "email": "test", "password": "test" }
    }))
    .expect("login request decodes");
    let response = client
        .bridge_request(request)
        .await
        .expect("transient disconnect is retried");
    assert_eq!(response.status, 204);
    server.await.expect("server completes");
}
