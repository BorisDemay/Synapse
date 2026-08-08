use std::time::Duration;

use synapse_core::{VaultChange, VaultPath, VaultWatcher};
use tempfile::tempdir;
use tokio::time::timeout;

#[tokio::test]
async fn reports_an_externally_created_markdown_note() {
    let directory = tempdir().unwrap();
    let mut watcher = VaultWatcher::watch(directory.path()).unwrap();
    let path = VaultPath::parse("notes/external.md").unwrap();

    tokio::fs::create_dir(directory.path().join("notes"))
        .await
        .unwrap();
    tokio::fs::write(directory.path().join(path.as_str()), "# External")
        .await
        .unwrap();

    assert_eq!(
        timeout(Duration::from_secs(2), watcher.next_change())
            .await
            .unwrap()
            .unwrap(),
        VaultChange::Created(path)
    );
}

#[tokio::test]
async fn does_not_report_a_suppressed_internal_write() {
    let directory = tempdir().unwrap();
    let watcher = VaultWatcher::watch(directory.path()).unwrap();
    let path = VaultPath::parse("notes/internal.md").unwrap();

    watcher.suppress_internal_change(&path);
    tokio::fs::create_dir(directory.path().join("notes"))
        .await
        .unwrap();
    tokio::fs::write(directory.path().join(path.as_str()), "# Internal")
        .await
        .unwrap();

    assert!(
        timeout(Duration::from_millis(200), async {
            let mut watcher = watcher;
            watcher.next_change().await
        })
        .await
        .is_err()
    );
}

#[tokio::test]
async fn reports_an_externally_modified_markdown_note() {
    let directory = tempdir().unwrap();
    tokio::fs::write(directory.path().join("external.md"), "# Before")
        .await
        .unwrap();
    let mut watcher = VaultWatcher::watch(directory.path()).unwrap();
    let path = VaultPath::parse("external.md").unwrap();

    tokio::fs::write(directory.path().join(path.as_str()), "# After")
        .await
        .unwrap();

    assert_eq!(
        timeout(Duration::from_secs(2), watcher.next_change())
            .await
            .unwrap()
            .unwrap(),
        VaultChange::Modified(path)
    );
}

#[tokio::test]
async fn reports_an_externally_renamed_markdown_note() {
    let directory = tempdir().unwrap();
    tokio::fs::write(directory.path().join("before.md"), "# Note")
        .await
        .unwrap();
    let mut watcher = VaultWatcher::watch(directory.path()).unwrap();
    let from = VaultPath::parse("before.md").unwrap();
    let to = VaultPath::parse("after.md").unwrap();

    tokio::fs::rename(
        directory.path().join(from.as_str()),
        directory.path().join(to.as_str()),
    )
    .await
    .unwrap();

    assert_eq!(
        timeout(Duration::from_secs(2), watcher.next_change())
            .await
            .unwrap()
            .unwrap(),
        VaultChange::Renamed { from, to }
    );
}

#[tokio::test]
async fn reports_an_externally_removed_markdown_note() {
    let directory = tempdir().unwrap();
    let path = VaultPath::parse("removed.md").unwrap();
    tokio::fs::write(directory.path().join(path.as_str()), "# Note")
        .await
        .unwrap();
    let mut watcher = VaultWatcher::watch(directory.path()).unwrap();

    tokio::fs::remove_file(directory.path().join(path.as_str()))
        .await
        .unwrap();

    assert_eq!(
        timeout(Duration::from_secs(2), watcher.next_change())
            .await
            .unwrap()
            .unwrap(),
        VaultChange::Removed(path)
    );
}

#[tokio::test]
async fn reports_when_the_vault_root_disappears() {
    let parent = tempdir().unwrap();
    let root = parent.path().join("vault");
    tokio::fs::create_dir(&root).await.unwrap();
    let mut watcher = VaultWatcher::watch(&root).unwrap();

    tokio::fs::remove_dir(&root).await.unwrap();

    assert_eq!(
        timeout(Duration::from_secs(2), watcher.next_change())
            .await
            .unwrap()
            .unwrap(),
        VaultChange::VaultRootRemoved
    );
}

#[tokio::test]
async fn coalesces_a_burst_of_external_writes() {
    let directory = tempdir().unwrap();
    let path = VaultPath::parse("burst.md").unwrap();
    let mut watcher = VaultWatcher::watch(directory.path()).unwrap();

    tokio::fs::write(directory.path().join(path.as_str()), "# One")
        .await
        .unwrap();
    tokio::fs::write(directory.path().join(path.as_str()), "# Two")
        .await
        .unwrap();

    assert_eq!(
        timeout(Duration::from_secs(2), watcher.next_change())
            .await
            .unwrap()
            .unwrap(),
        VaultChange::Created(path)
    );
    assert!(
        timeout(Duration::from_millis(150), watcher.next_change())
            .await
            .is_err()
    );
}
