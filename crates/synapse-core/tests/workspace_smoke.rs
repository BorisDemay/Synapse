use synapse_core::version;

#[test]
fn exposes_workspace_version() {
    assert_eq!(version(), env!("CARGO_PKG_VERSION"));
}
