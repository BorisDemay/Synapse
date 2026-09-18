#[test]
fn configuration_rejects_a_missing_database_url() {
    let result = synapse_server::config::ServerConfig::from_values(Some("127.0.0.1:3000"), None);
    let error = match result {
        Ok(_) => panic!("configuration without a database URL must be rejected"),
        Err(error) => error,
    };

    assert_eq!(error.to_string(), "SYNAPSE_DATABASE_URL is required");
}
