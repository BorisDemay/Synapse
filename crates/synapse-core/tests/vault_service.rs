use synapse_core::{ContentHash, VaultPath, VaultService};
use tempfile::tempdir;

#[tokio::test]
async fn ordinary_and_canonical_roots_support_nested_writes() {
    let directory = tempdir().unwrap();
    let canonical = tokio::fs::canonicalize(directory.path()).await.unwrap();
    for (index, root) in [directory.path(), canonical.as_path()]
        .into_iter()
        .enumerate()
    {
        let vault = VaultService::open(root).await.expect("root opens");
        let note = VaultPath::parse(&format!("notes/root-{index}.md")).unwrap();
        vault
            .create_note(&note, "# Canonical path")
            .await
            .expect("nested write stays inside the root");
        assert_eq!(vault.read_note(&note).await.unwrap(), "# Canonical path");
    }
}

#[tokio::test]
async fn create_note_writes_markdown_inside_vault() {
    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let path = VaultPath::parse("notes/hello.md").unwrap();

    vault.create_note(&path, "# Hello").await.unwrap();

    assert_eq!(
        tokio::fs::read_to_string(directory.path().join("notes/hello.md"))
            .await
            .unwrap(),
        "# Hello"
    );
}

#[tokio::test]
async fn read_note_returns_markdown_written_in_the_vault() {
    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let path = VaultPath::parse("notes/readable.md").unwrap();
    vault.create_note(&path, "# Readable").await.unwrap();

    assert_eq!(vault.read_note(&path).await.unwrap(), "# Readable");
}

#[tokio::test]
async fn rename_note_moves_markdown_to_a_new_vault_path() {
    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let source = VaultPath::parse("notes/draft.md").unwrap();
    let destination = VaultPath::parse("archive/published.md").unwrap();
    vault.create_note(&source, "# Published").await.unwrap();

    vault.rename_note(&source, &destination).await.unwrap();

    assert!(
        !tokio::fs::try_exists(directory.path().join("notes/draft.md"))
            .await
            .unwrap()
    );
    assert_eq!(vault.read_note(&destination).await.unwrap(), "# Published");
}

#[tokio::test]
async fn create_note_rejects_an_existing_note_without_replacing_its_content() {
    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let path = VaultPath::parse("notes/existing.md").unwrap();
    vault.create_note(&path, "# Original").await.unwrap();

    assert!(vault.create_note(&path, "# Replacement").await.is_err());
    assert_eq!(vault.read_note(&path).await.unwrap(), "# Original");
}

#[tokio::test]
async fn delete_note_moves_markdown_to_the_internal_trash() {
    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let path = VaultPath::parse("notes/deleted.md").unwrap();
    vault.create_note(&path, "# Retained").await.unwrap();

    vault.delete_note(&path).await.unwrap();

    assert!(
        !tokio::fs::try_exists(directory.path().join("notes/deleted.md"))
            .await
            .unwrap()
    );
    assert_eq!(
        tokio::fs::read_to_string(directory.path().join(".synapse-trash/notes/deleted.md"))
            .await
            .unwrap(),
        "# Retained"
    );
}

#[tokio::test]
async fn create_note_rejects_markdown_larger_than_ten_mebibytes() {
    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let path = VaultPath::parse("notes/too-large.md").unwrap();
    let content = "x".repeat(10 * 1024 * 1024 + 1);

    assert!(vault.create_note(&path, &content).await.is_err());
    assert!(
        !tokio::fs::try_exists(directory.path().join("notes/too-large.md"))
            .await
            .unwrap()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn create_note_rejects_a_final_symlink_that_points_outside_the_vault() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let path = VaultPath::parse("notes/linked.md").unwrap();
    tokio::fs::create_dir(directory.path().join("notes"))
        .await
        .unwrap();
    symlink(
        outside.path().join("outside.md"),
        directory.path().join("notes/linked.md"),
    )
    .unwrap();

    assert_eq!(
        vault
            .create_note(&path, "# Unsafe")
            .await
            .unwrap_err()
            .to_string(),
        "vault path escapes the vault root"
    );
    assert!(
        !tokio::fs::try_exists(outside.path().join("outside.md"))
            .await
            .unwrap()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn vault_operations_reject_a_final_symlink_even_when_its_target_is_inside_the_vault() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let target = VaultPath::parse("notes/target.md").unwrap();
    let linked = VaultPath::parse("notes/linked.md").unwrap();
    vault.create_note(&target, "# Inside").await.unwrap();
    symlink(
        directory.path().join("notes/target.md"),
        directory.path().join("notes/linked.md"),
    )
    .unwrap();

    assert_eq!(
        vault
            .create_note(&linked, "# Unsafe")
            .await
            .unwrap_err()
            .to_string(),
        "vault path escapes the vault root"
    );
    assert_eq!(
        vault
            .replace_note_if_unchanged(&linked, &ContentHash::from_bytes(b"# Inside"), "# Unsafe")
            .await
            .unwrap_err()
            .to_string(),
        "vault path escapes the vault root"
    );
    assert_eq!(
        vault.read_note(&linked).await.unwrap_err().to_string(),
        "vault path escapes the vault root"
    );
    assert_eq!(
        vault.delete_note(&linked).await.unwrap_err().to_string(),
        "vault path escapes the vault root"
    );
    assert_eq!(vault.read_note(&target).await.unwrap(), "# Inside");
}

#[tokio::test]
async fn replace_note_rejects_content_changed_since_the_caller_read_it() {
    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let path = VaultPath::parse("notes/concurrent.md").unwrap();
    vault.create_note(&path, "# Original").await.unwrap();
    let expected_hash = ContentHash::from_bytes(b"# Original");
    tokio::fs::write(directory.path().join("notes/concurrent.md"), "# External")
        .await
        .unwrap();

    assert!(
        vault
            .replace_note_if_unchanged(&path, &expected_hash, "# Local")
            .await
            .is_err()
    );
    assert_eq!(vault.read_note(&path).await.unwrap(), "# External");
}

#[tokio::test]
async fn replace_note_atomically_updates_matching_content() {
    let directory = tempdir().unwrap();
    let vault = VaultService::open(directory.path()).await.unwrap();
    let path = VaultPath::parse("notes/current.md").unwrap();
    vault.create_note(&path, "# Original").await.unwrap();
    let expected_hash = ContentHash::from_bytes(b"# Original");

    vault
        .replace_note_if_unchanged(&path, &expected_hash, "# Updated")
        .await
        .unwrap();

    assert_eq!(vault.read_note(&path).await.unwrap(), "# Updated");
}
