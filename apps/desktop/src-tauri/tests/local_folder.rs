use synapse_core::{VaultAssetPath, VaultPath};
use tempfile::tempdir;

use synapse_desktop::local_folder::{FolderEntry, LocalFolderMirror};

#[cfg(unix)]
#[tokio::test]
async fn mirror_rejects_a_symlinked_root() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().expect("tempdir");
    let linked_root = directory.path().join("linked-root");
    let target = tempdir().expect("target tempdir");
    symlink(target.path(), &linked_root).expect("symlink");

    let error = match LocalFolderMirror::open(&linked_root).await {
        Err(error) => error,
        Ok(_) => panic!("symlinked root is accepted"),
    };

    assert_eq!(error, "local folder is unavailable");
}

#[cfg(unix)]
#[tokio::test]
async fn mirror_rejects_a_root_with_a_symlinked_parent() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().expect("tempdir");
    let target = tempdir().expect("target tempdir");
    let linked_parent = directory.path().join("linked-parent");
    symlink(target.path(), &linked_parent).expect("symlink");

    let error = match LocalFolderMirror::open(linked_parent.join("nested")).await {
        Err(error) => error,
        Ok(_) => panic!("root with a symlinked parent is accepted"),
    };

    assert_eq!(error, "local folder is unavailable");
    assert!(
        !tokio::fs::try_exists(target.path().join("nested"))
            .await
            .expect("nested root lookup")
    );
}

#[tokio::test]
async fn mirror_upserts_markdown_inside_the_chosen_root() {
    let directory = tempdir().expect("tempdir");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");

    mirror
        .apply(&[FolderEntry::Note {
            path: "notes/hello.md".to_owned(),
            markdown: "# Hello".to_owned(),
        }])
        .await
        .expect("write succeeds");
    mirror
        .apply(&[FolderEntry::Note {
            path: "notes/hello.md".to_owned(),
            markdown: "# Updated".to_owned(),
        }])
        .await
        .expect("overwrite succeeds");

    assert_eq!(
        tokio::fs::read_to_string(directory.path().join("notes/hello.md"))
            .await
            .expect("file reads"),
        "# Updated"
    );
}

#[tokio::test]
async fn mirror_rejects_a_path_that_escapes_the_root() {
    let directory = tempdir().expect("tempdir");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");

    let error = mirror
        .apply(&[FolderEntry::Note {
            path: "../escape.md".to_owned(),
            markdown: "# no".to_owned(),
        }])
        .await
        .expect_err("traversal is rejected");

    assert_eq!(error, "invalid vault path");
    assert!(
        !tokio::fs::try_exists(directory.path().join("../escape.md"))
            .await
            .unwrap_or(true)
            || VaultPath::parse("../escape.md").is_err()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn mirror_refuses_to_remove_a_written_file_through_an_outgoing_symlinked_parent() {
    use std::collections::BTreeSet;
    use std::os::unix::fs::symlink;

    let directory = tempdir().expect("tempdir");
    let outside = tempdir().expect("outside tempdir");
    let outside_note = outside.path().join("outside.md");
    tokio::fs::write(&outside_note, "# Outside")
        .await
        .expect("outside note");
    symlink(outside.path(), directory.path().join("notes")).expect("parent symlink");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    mirror.set_written(BTreeSet::from(["notes/outside.md".to_owned()]));

    let error = mirror
        .replace_snapshot(&[])
        .await
        .expect_err("symlinked parent is rejected");

    assert_eq!(error, "local folder write failed");
    assert_eq!(
        tokio::fs::read_to_string(outside_note)
            .await
            .expect("outside note remains"),
        "# Outside"
    );
}

#[tokio::test]
async fn snapshot_removes_files_no_longer_present_without_pruning_foreign_files() {
    let directory = tempdir().expect("tempdir");
    tokio::fs::write(directory.path().join("keep-me.txt"), b"foreign")
        .await
        .expect("foreign file");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");

    mirror
        .replace_snapshot(&[
            FolderEntry::Note {
                path: "inbox.md".to_owned(),
                markdown: "# Inbox".to_owned(),
            },
            FolderEntry::Attachment {
                path: "attachments/a.bin".to_owned(),
                bytes: vec![1, 2, 3],
            },
        ])
        .await
        .expect("snapshot writes");
    mirror
        .replace_snapshot(&[FolderEntry::Note {
            path: "inbox.md".to_owned(),
            markdown: "# Inbox".to_owned(),
        }])
        .await
        .expect("snapshot updates");

    assert!(
        !tokio::fs::try_exists(directory.path().join("attachments/a.bin"))
            .await
            .expect("attachment lookup")
    );
    assert_eq!(
        tokio::fs::read(directory.path().join("keep-me.txt"))
            .await
            .expect("foreign file remains"),
        b"foreign"
    );
    assert!(VaultAssetPath::parse("attachments/a.bin").is_ok());
}

#[test]
fn default_folder_path_nests_a_validated_vault_id() {
    let root = std::path::Path::new("/tmp");
    let vault_id = "0198e5de-1111-7222-8333-444455556666";
    let path = synapse_desktop::local_folder::default_folder_path(root, vault_id)
        .expect("uuid vault id is accepted");
    assert_eq!(path, root.join("Synapse").join(vault_id));
    assert!(synapse_desktop::local_folder::default_folder_path(root, "../escape").is_err());
}
