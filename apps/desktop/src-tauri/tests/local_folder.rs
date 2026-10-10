use synapse_core::{VaultAssetPath, VaultPath};
use tempfile::tempdir;

use synapse_desktop::local_folder::{ExternalMarkdownCandidate, FolderEntry, LocalFolderMirror};

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

#[tokio::test]
async fn discovery_classifies_an_owned_modified_markdown_without_mutation() {
    let directory = tempdir().expect("tempdir");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    mirror
        .apply(&[FolderEntry::Note {
            path: "owned.md".to_owned(),
            markdown: "canonical".to_owned(),
        }])
        .await
        .expect("mirror writes owned note");
    let manifest = directory.path().join("attachments/.synapse-mirror.json");
    let manifest_before = tokio::fs::read(&manifest).await.expect("manifest reads");
    let note = directory.path().join("owned.md");
    tokio::fs::write(&note, "external edit")
        .await
        .expect("external edit writes");
    let note_before = tokio::fs::read(&note).await.expect("note reads");
    let written_before = mirror.written();

    let candidates = mirror.discover_external_markdown().await;

    assert_eq!(
        candidates,
        vec![ExternalMarkdownCandidate::OwnedModified {
            path: VaultPath::parse("owned.md").expect("valid owned path"),
        }]
    );
    assert_eq!(
        tokio::fs::read(&manifest).await.expect("manifest reads"),
        manifest_before
    );
    assert_eq!(
        tokio::fs::read(&note).await.expect("note reads"),
        note_before
    );
    assert_eq!(mirror.written(), written_before);
}

#[tokio::test]
async fn discovery_classifies_an_unknown_markdown_without_adopting_it() {
    let directory = tempdir().expect("tempdir");
    let mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    let manifest = directory.path().join("attachments/.synapse-mirror.json");
    mirror
        .claim_selection()
        .await
        .expect("empty folder is claimed");
    let manifest_before = tokio::fs::read(&manifest).await.expect("manifest reads");
    let note = directory.path().join("unknown.md");
    tokio::fs::write(&note, "external note")
        .await
        .expect("external note writes");
    let note_before = tokio::fs::read(&note).await.expect("note reads");
    let written_before = mirror.written();

    let candidates = mirror.discover_external_markdown().await;

    assert_eq!(
        candidates,
        vec![ExternalMarkdownCandidate::Unknown {
            path: VaultPath::parse("unknown.md").expect("valid unknown path"),
        }]
    );
    assert_eq!(
        tokio::fs::read(&manifest).await.expect("manifest reads"),
        manifest_before
    );
    assert_eq!(
        tokio::fs::read(&note).await.expect("note reads"),
        note_before
    );
    assert_eq!(mirror.written(), written_before);
}

#[cfg(unix)]
#[tokio::test]
async fn discovery_refuses_a_symlinked_markdown_without_mutation() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().expect("tempdir");
    let outside = tempdir().expect("outside tempdir");
    let outside_note = outside.path().join("owned.md");
    tokio::fs::write(&outside_note, "outside content")
        .await
        .expect("outside note writes");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    mirror
        .apply(&[FolderEntry::Note {
            path: "owned.md".to_owned(),
            markdown: "canonical".to_owned(),
        }])
        .await
        .expect("mirror writes owned note");
    let manifest = directory.path().join("attachments/.synapse-mirror.json");
    let manifest_before = tokio::fs::read(&manifest).await.expect("manifest reads");
    let note = directory.path().join("owned.md");
    tokio::fs::remove_file(&note)
        .await
        .expect("owned note removes");
    symlink(&outside_note, &note).expect("symlink replaces owned note");
    let outside_before = tokio::fs::read(&outside_note)
        .await
        .expect("outside note reads");
    let written_before = mirror.written();

    let candidates = mirror.discover_external_markdown().await;

    assert_eq!(candidates, vec![ExternalMarkdownCandidate::Dangerous]);
    assert_eq!(
        tokio::fs::read(&manifest).await.expect("manifest reads"),
        manifest_before
    );
    assert_eq!(
        tokio::fs::read(&outside_note)
            .await
            .expect("outside note reads"),
        outside_before
    );
    assert_eq!(mirror.written(), written_before);
}

// Two names differing only by case are one file on the default Windows
// filesystem, so this on-disk collision can only be staged on Linux.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn discovery_refuses_case_colliding_markdown_without_mutation() {
    let directory = tempdir().expect("tempdir");
    let mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    mirror
        .claim_selection()
        .await
        .expect("empty folder is claimed");
    let manifest = directory.path().join("attachments/.synapse-mirror.json");
    let manifest_before = tokio::fs::read(&manifest).await.expect("manifest reads");
    let upper = directory.path().join("Note.md");
    let lower = directory.path().join("note.md");
    tokio::fs::write(&upper, "upper")
        .await
        .expect("upper note writes");
    tokio::fs::write(&lower, "lower")
        .await
        .expect("lower note writes");
    let upper_before = tokio::fs::read(&upper).await.expect("upper note reads");
    let lower_before = tokio::fs::read(&lower).await.expect("lower note reads");
    let written_before = mirror.written();

    let candidates = mirror.discover_external_markdown().await;

    assert_eq!(candidates, vec![ExternalMarkdownCandidate::Ambiguous]);
    assert_eq!(
        tokio::fs::read(&manifest).await.expect("manifest reads"),
        manifest_before
    );
    assert_eq!(
        tokio::fs::read(&upper).await.expect("upper note reads"),
        upper_before
    );
    assert_eq!(
        tokio::fs::read(&lower).await.expect("lower note reads"),
        lower_before
    );
    assert_eq!(mirror.written(), written_before);
}

#[tokio::test]
async fn discovery_marks_a_scan_to_read_replacement_ambiguous_without_mutation() {
    let directory = tempdir().expect("tempdir");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    mirror
        .apply(&[FolderEntry::Note {
            path: "owned.md".to_owned(),
            markdown: "canonical".to_owned(),
        }])
        .await
        .expect("mirror writes owned note");
    let manifest = directory.path().join("attachments/.synapse-mirror.json");
    let manifest_before = tokio::fs::read(&manifest).await.expect("manifest reads");
    let note = directory.path().join("owned.md");
    let written_before = mirror.written();

    let candidates = mirror
        .discover_external_markdown_with_before_read(|candidate| {
            std::fs::remove_file(candidate).expect("candidate removes");
            std::fs::write(candidate, "replacement").expect("replacement writes");
        })
        .await;

    assert_eq!(candidates, vec![ExternalMarkdownCandidate::Ambiguous]);
    assert_eq!(
        tokio::fs::read(&manifest).await.expect("manifest reads"),
        manifest_before
    );
    assert_eq!(
        tokio::fs::read(&note).await.expect("replacement reads"),
        b"replacement"
    );
    assert_eq!(mirror.written(), written_before);
}

const BINDING: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_BINDING: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

#[tokio::test]
async fn install_binds_a_canonical_note_and_survives_restart() {
    let directory = tempdir().expect("tempdir");
    let path = VaultPath::parse("owned.md").expect("valid owned path");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");

    mirror
        .install_note_binding("owned.md", "canonical", BINDING)
        .await
        .expect("canonical note installs");

    assert_eq!(
        tokio::fs::read(directory.path().join("owned.md"))
            .await
            .expect("note reads"),
        b"canonical"
    );
    assert_eq!(mirror.binding_id(&path), Some(BINDING));
    let manifest =
        tokio::fs::read_to_string(directory.path().join("attachments/.synapse-mirror.json"))
            .await
            .expect("manifest reads");
    assert!(!manifest.contains("canonical"));
    let reopened = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror reopens");
    assert_eq!(reopened.binding_id(&path), Some(BINDING));
}

#[tokio::test]
async fn legacy_manifest_entries_stay_unbound_despite_matching_content() {
    let directory = tempdir().expect("tempdir");
    tokio::fs::create_dir(directory.path().join("attachments"))
        .await
        .expect("attachments directory creates");
    tokio::fs::write(directory.path().join("owned.md"), "canonical")
        .await
        .expect("note writes");
    let legacy = serde_json::json!({ "owner": "test-profile", "hashes": {"owned.md": [synapse_core::ContentHash::from_bytes(b"canonical").to_string()] }});
    tokio::fs::write(
        directory.path().join("attachments/.synapse-mirror.json"),
        serde_json::to_vec(&legacy).expect("manifest serializes"),
    )
    .await
    .expect("legacy manifest writes");

    let mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("legacy manifest stays readable");

    assert_eq!(
        mirror.binding_id(&VaultPath::parse("owned.md").expect("valid owned path")),
        None
    );
    assert_eq!(mirror.discover_external_markdown().await, vec![]);
}

#[tokio::test]
async fn install_replay_is_idempotent_and_never_creates_a_second_binding() {
    let directory = tempdir().expect("tempdir");
    let path = VaultPath::parse("owned.md").expect("valid owned path");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    mirror
        .install_note_binding("owned.md", "canonical", BINDING)
        .await
        .expect("canonical note installs");
    let manifest = directory.path().join("attachments/.synapse-mirror.json");
    let manifest_before = tokio::fs::read(&manifest).await.expect("manifest reads");

    mirror
        .install_note_binding("owned.md", "canonical", BINDING)
        .await
        .expect("replay succeeds");
    assert_eq!(
        tokio::fs::read(&manifest).await.expect("manifest reads"),
        manifest_before
    );

    assert!(
        mirror
            .install_note_binding("owned.md", "canonical", OTHER_BINDING)
            .await
            .is_err()
    );
    assert!(
        mirror
            .install_note_binding("other.md", "canonical", BINDING)
            .await
            .is_err()
    );
    assert_eq!(mirror.binding_id(&path), Some(BINDING));
    assert!(!directory.path().join("other.md").exists());
    assert_eq!(
        tokio::fs::read(&manifest).await.expect("manifest reads"),
        manifest_before
    );
}

#[tokio::test]
async fn install_refuses_an_externally_modified_replica_without_binding_it() {
    let directory = tempdir().expect("tempdir");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    mirror
        .apply(&[FolderEntry::Note {
            path: "owned.md".to_owned(),
            markdown: "canonical".to_owned(),
        }])
        .await
        .expect("mirror writes owned note");
    let note = directory.path().join("owned.md");
    tokio::fs::write(&note, "external edit")
        .await
        .expect("external edit writes");

    let error = mirror
        .install_note_binding("owned.md", "newer canonical", BINDING)
        .await
        .expect_err("divergent replica is refused");

    assert!(!error.contains("owned.md") && !error.contains("external edit"));
    assert_eq!(
        tokio::fs::read(&note).await.expect("note reads"),
        b"external edit"
    );
    assert_eq!(
        mirror.binding_id(&VaultPath::parse("owned.md").expect("valid owned path")),
        None
    );
    let reopened = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror reopens");
    assert_eq!(
        reopened.binding_id(&VaultPath::parse("owned.md").expect("valid owned path")),
        None
    );
}

#[tokio::test]
async fn install_rejects_malformed_bindings_and_paths_before_writing() {
    let directory = tempdir().expect("tempdir");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");

    for binding in [
        "",
        "owned.md",
        "0F8FAD5B-D9CB-469F-A165-70867728950E",
        "0f8fad5bd9cb469fa16570867728950e",
    ] {
        assert!(
            mirror
                .install_note_binding("owned.md", "canonical", binding)
                .await
                .is_err()
        );
    }
    assert!(
        mirror
            .install_note_binding("../escape.md", "canonical", BINDING)
            .await
            .is_err()
    );
    assert!(!directory.path().join("owned.md").exists());
}

#[tokio::test]
async fn manifest_with_inconsistent_bindings_is_rejected() {
    for bindings in [
        serde_json::json!({ "missing.md": BINDING }),
        serde_json::json!({ "a.md": BINDING, "b.md": BINDING }),
        serde_json::json!({ "a.md": "not-a-binding" }),
    ] {
        let directory = tempdir().expect("tempdir");
        tokio::fs::create_dir(directory.path().join("attachments"))
            .await
            .expect("attachments directory creates");
        let hash = synapse_core::ContentHash::from_bytes(b"canonical").to_string();
        let manifest = serde_json::json!({ "version": 2, "owner": "test-profile", "hashes": {"a.md": [hash.clone()], "b.md": [hash] }, "bindings": bindings });
        tokio::fs::write(
            directory.path().join("attachments/.synapse-mirror.json"),
            serde_json::to_vec(&manifest).expect("manifest serializes"),
        )
        .await
        .expect("manifest writes");

        assert!(LocalFolderMirror::open(directory.path()).await.is_err());
    }
}

#[tokio::test]
async fn snapshot_removal_drops_the_binding_of_a_removed_note() {
    let directory = tempdir().expect("tempdir");
    let path = VaultPath::parse("owned.md").expect("valid owned path");
    let mut mirror = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror opens");
    mirror
        .install_note_binding("owned.md", "canonical", BINDING)
        .await
        .expect("canonical note installs");

    mirror
        .replace_snapshot(&[])
        .await
        .expect("snapshot removes the note");

    assert_eq!(mirror.binding_id(&path), None);
    let reopened = LocalFolderMirror::open(directory.path())
        .await
        .expect("mirror reopens");
    assert_eq!(reopened.binding_id(&path), None);
}
