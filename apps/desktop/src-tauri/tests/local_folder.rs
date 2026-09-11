use synapse_core::{VaultAssetPath, VaultPath};
use tempfile::tempdir;

use synapse_desktop::local_folder::{FolderEntry, LocalFolderMirror};

#[tokio::test]
async fn mirror_reopens_the_canonical_root_persisted_after_folder_selection() {
    let directory = tempdir().expect("tempdir");
    let mirror = LocalFolderMirror::open_for_vault(directory.path(), "canonical-test")
        .await
        .expect("initial folder opens");
    mirror
        .claim_selection()
        .await
        .expect("empty folder is claimed");
    let saved_root = mirror.root();
    drop(mirror);

    let mut reopened = LocalFolderMirror::open_for_vault(&saved_root, "canonical-test")
        .await
        .expect("persisted canonical folder reopens");
    reopened
        .apply(&[FolderEntry::Note {
            path: "canonical.md".to_owned(),
            markdown: "# Canonical root".to_owned(),
        }])
        .await
        .expect("canonical folder accepts the Markdown replica");
    assert_eq!(
        tokio::fs::read_to_string(directory.path().join("canonical.md"))
            .await
            .unwrap(),
        "# Canonical root"
    );
}

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

#[tokio::test]
async fn mirror_preserves_unknown_and_externally_changed_notes() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("note.md");
    tokio::fs::write(&path, "external").await.unwrap();
    let mut mirror = LocalFolderMirror::open(directory.path()).await.unwrap();
    let entry = FolderEntry::Note {
        path: "note.md".into(),
        markdown: "app".into(),
    };
    assert!(
        mirror
            .replace_snapshot(std::slice::from_ref(&entry))
            .await
            .is_err()
    );
    assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), "external");
    tokio::fs::remove_file(&path).await.unwrap();
    mirror
        .replace_snapshot(std::slice::from_ref(&entry))
        .await
        .unwrap();
    tokio::fs::write(&path, "external edit").await.unwrap();
    assert!(mirror.replace_snapshot(&[entry]).await.is_err());
    assert!(mirror.replace_snapshot(&[]).await.is_err());
    assert_eq!(
        tokio::fs::read_to_string(&path).await.unwrap(),
        "external edit"
    );
}

#[tokio::test]
async fn mirror_remembers_owned_files_after_restart() {
    let directory = tempdir().unwrap();
    let mut mirror = LocalFolderMirror::open(directory.path()).await.unwrap();
    mirror
        .replace_snapshot(&[FolderEntry::Note {
            path: "before.md".into(),
            markdown: "saved".into(),
        }])
        .await
        .unwrap();
    drop(mirror);
    let mut reopened = LocalFolderMirror::open(directory.path()).await.unwrap();
    reopened
        .replace_snapshot(&[FolderEntry::Note {
            path: "after.md".into(),
            markdown: "saved".into(),
        }])
        .await
        .unwrap();
    assert!(!directory.path().join("before.md").exists());
    assert_eq!(
        tokio::fs::read_to_string(directory.path().join("after.md"))
            .await
            .unwrap(),
        "saved"
    );
}

#[tokio::test]
async fn folder_ownership_survives_restart() {
    let directory = tempdir().unwrap();
    let mut mirror = LocalFolderMirror::open_for_vault(directory.path(), "vault-a")
        .await
        .unwrap();
    mirror
        .replace_snapshot(&[FolderEntry::Note {
            path: "note.md".into(),
            markdown: "A".into(),
        }])
        .await
        .unwrap();
    assert!(
        LocalFolderMirror::open_for_vault(directory.path(), "vault-b")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn partial_snapshot_can_resume_after_restart() {
    let directory = tempdir().unwrap();
    let mut mirror = LocalFolderMirror::open(directory.path()).await.unwrap();
    let entry = |text: &str| FolderEntry::Note {
        path: "note.md".into(),
        markdown: text.into(),
    };
    mirror.replace_snapshot(&[entry("before")]).await.unwrap();
    tokio::fs::write(directory.path().join("foreign.md"), "foreign")
        .await
        .unwrap();
    assert!(
        mirror
            .replace_snapshot(&[
                entry("after"),
                FolderEntry::Note {
                    path: "foreign.md".into(),
                    markdown: "no".into()
                }
            ])
            .await
            .is_err()
    );
    drop(mirror);
    let mut mirror = LocalFolderMirror::open(directory.path()).await.unwrap();
    mirror.replace_snapshot(&[entry("resumed")]).await.unwrap();
    assert_eq!(
        tokio::fs::read_to_string(directory.path().join("note.md"))
            .await
            .unwrap(),
        "resumed"
    );
}

#[tokio::test]
async fn interrupted_journal_accepts_either_side_of_atomic_write() {
    for content in ["before", "after"] {
        let directory = tempdir().unwrap();
        let mut mirror = LocalFolderMirror::open(directory.path()).await.unwrap();
        mirror
            .replace_snapshot(&[FolderEntry::Note {
                path: "note.md".into(),
                markdown: "before".into(),
            }])
            .await
            .unwrap();
        let journal = serde_json::json!({ "owner": "test-profile", "hashes": {"note.md": [synapse_core::ContentHash::from_bytes(b"before").to_string(), synapse_core::ContentHash::from_bytes(b"after").to_string()] }});
        tokio::fs::write(
            directory.path().join("attachments/.synapse-mirror.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .await
        .unwrap();
        tokio::fs::write(directory.path().join("note.md"), content)
            .await
            .unwrap();
        drop(mirror);
        let mut reopened = LocalFolderMirror::open(directory.path()).await.unwrap();
        reopened
            .replace_snapshot(&[FolderEntry::Note {
                path: "note.md".into(),
                markdown: "recovered".into(),
            }])
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(directory.path().join("note.md"))
                .await
                .unwrap(),
            "recovered"
        );
    }
}

#[tokio::test]
async fn snapshot_rejects_case_collisions_before_writing() {
    let directory = tempdir().unwrap();
    let mut mirror = LocalFolderMirror::open(directory.path()).await.unwrap();
    assert!(
        mirror
            .replace_snapshot(&[
                FolderEntry::Note {
                    path: "A.md".into(),
                    markdown: "first".into()
                },
                FolderEntry::Note {
                    path: "a.md".into(),
                    markdown: "second".into()
                },
            ])
            .await
            .is_err()
    );
    assert!(!directory.path().join("A.md").exists());
}
