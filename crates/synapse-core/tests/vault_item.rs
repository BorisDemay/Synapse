use synapse_core::{
    DecodedVaultItem, VaultAssetPath, VaultItem, VaultPath, decode_vault_item, legacy_web_note_path,
};

#[test]
fn encodes_a_note_path_inside_the_item_not_as_a_wire_field() {
    let item = VaultItem::Note {
        path: VaultPath::parse("projects/roadmap.md").unwrap(),
        markdown: "# Roadmap\n\nSecret plan.".to_owned(),
    };

    let encoded = item.encode().unwrap();
    let decoded = decode_vault_item(&encoded).unwrap();

    assert!(
        std::str::from_utf8(&encoded)
            .unwrap()
            .contains("projects/roadmap.md")
    );
    assert_eq!(decoded, DecodedVaultItem::Item(item));
}

#[test]
fn decodes_legacy_markdown_without_a_header() {
    let decoded = decode_vault_item(b"# Ancienne note\n").unwrap();

    assert_eq!(
        decoded,
        DecodedVaultItem::LegacyNote {
            markdown: "# Ancienne note\n".to_owned(),
        }
    );
}

#[test]
fn encodes_an_attachment_under_attachments() {
    let item = VaultItem::Attachment {
        path: VaultAssetPath::parse("attachments/scan.pdf").unwrap(),
        content_type: "application/pdf".to_owned(),
        bytes: b"%PDF-secret".to_vec(),
    };

    let decoded = decode_vault_item(&item.encode().unwrap()).unwrap();
    assert_eq!(decoded, DecodedVaultItem::Item(item));
}

#[test]
fn rejects_parent_segments_and_executables_for_attachments() {
    assert!(VaultAssetPath::parse("attachments/../secret.pdf").is_err());
    assert!(VaultAssetPath::parse("notes/scan.pdf").is_err());
    assert!(VaultAssetPath::parse("attachments/payload.exe").is_err());
    assert!(VaultAssetPath::parse("attachments/payload.PS1").is_err());
}

#[test]
fn rejects_items_larger_than_ten_mebibytes() {
    let item = VaultItem::Note {
        path: VaultPath::parse("huge.md").unwrap(),
        markdown: "a".repeat(10 * 1024 * 1024),
    };

    assert!(item.encode().is_err());
}

#[test]
fn derives_a_stable_legacy_web_path() {
    assert_eq!(
        legacy_web_note_path("0198e5de-7777-7888-8999-aaaabbbbcccc")
            .unwrap()
            .as_str(),
        "notes/0198e5de.md"
    );
}
