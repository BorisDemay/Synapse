use synapse_core::VaultPath;

#[test]
fn vault_paths_reject_linux_and_windows_traversal_and_device_forms() {
    let rejected = [
        "notes/../../secret.md",
        "../secret.md",
        "/etc/passwd.md",
        "notes\\..\\secret.md",
        "C:/windows/system32/config.md",
        "notes/project:stream.md",
        "notes/\0evil.md",
        "",
        "notes/project.txt",
    ];
    for path in rejected {
        assert!(
            VaultPath::parse(path).is_err(),
            "expected rejection for {path}"
        );
    }
}

#[test]
fn vault_paths_normalize_windows_separators_for_safe_notes() {
    let path = VaultPath::parse("notes\\project.md").expect("safe path");
    assert_eq!(path.as_str(), "notes/project.md");
}
