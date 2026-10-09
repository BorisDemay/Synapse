use synapse_core::{
    ContentHash, NoteId, OperationId, Revision, VaultAssetPath, VaultId, VaultPath,
};

#[test]
fn vault_path_rejects_parent_segments() {
    let error = VaultPath::parse("notes/../../secret.md").unwrap_err();

    assert_eq!(error.to_string(), "vault path contains a parent segment");
}

#[test]
fn vault_path_normalizes_windows_separators() {
    let path = VaultPath::parse("notes\\project.md").unwrap();

    assert_eq!(path.as_str(), "notes/project.md");
}

#[test]
fn vault_path_rejects_absolute_paths() {
    for path in [
        "/notes/project.md",
        "C:\\notes\\project.md",
        "\\\\server\\share\\project.md",
    ] {
        assert!(VaultPath::parse(path).is_err(), "{path}");
    }
}

#[test]
fn vault_path_rejects_empty_paths() {
    assert!(VaultPath::parse("").is_err());
}

#[test]
fn vault_path_rejects_nul_bytes() {
    assert!(VaultPath::parse("notes/\0project.md").is_err());
}

#[test]
fn vault_path_rejects_non_markdown_notes() {
    assert!(VaultPath::parse("notes/project.txt").is_err());
}

#[test]
fn vault_path_rejects_windows_ambiguous_segments() {
    for path in ["notes/.. /secret.md", "notes/folder./secret.md"] {
        assert!(VaultPath::parse(path).is_err(), "{path}");
    }
}

#[test]
fn vault_path_rejects_windows_alternate_data_streams() {
    assert!(VaultPath::parse("notes/project:metadata.md").is_err());
}

#[test]
fn vault_asset_path_accepts_nested_files_under_attachments() {
    let path = VaultAssetPath::parse("attachments\\scans\\doc.pdf").unwrap();
    assert_eq!(path.as_str(), "attachments/scans/doc.pdf");
}

#[test]
fn domain_identifiers_are_uuidv7() {
    for identifier in [
        VaultId::new().to_string(),
        NoteId::new().to_string(),
        OperationId::new().to_string(),
    ] {
        assert_eq!(identifier.as_bytes()[14], b'7');
    }
}

#[test]
fn revision_rejects_zero() {
    assert!(Revision::new(0).is_err());
}

#[test]
fn content_hash_is_sha256_hex() {
    assert_eq!(
        ContentHash::from_bytes(b"synapse").to_string(),
        "f208248e5969ffdb9c213257a843a0d8b8b437ae8265dd19a2398f3f212a1566"
    );
}
