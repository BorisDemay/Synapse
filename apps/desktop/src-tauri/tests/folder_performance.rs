use std::time::Instant;
use synapse_desktop::local_folder::{FolderEntry, LocalFolderMirror};

#[tokio::test]
#[ignore = "reproducible filesystem benchmark; run explicitly"]
async fn ten_thousand_note_replica() {
    let count: usize = std::env::var("SYNAPSE_BENCH_NOTES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(10_000);
    let directory = tempfile::tempdir().unwrap();
    let mut mirror = LocalFolderMirror::open(directory.path()).await.unwrap();
    let mut entries: Vec<_> = (0..count)
        .map(|i| FolderEntry::Note {
            path: format!("notes/{i:05}.md"),
            markdown: format!("# Note {i}\n{}", "synthetic fixture ".repeat(60)),
        })
        .collect();
    let start = Instant::now();
    mirror.replace_snapshot(&entries).await.unwrap();
    let create_ms = start.elapsed().as_millis();
    let unchanged = directory.path().join("notes/00000.md");
    let modified_before = std::fs::metadata(&unchanged).unwrap().modified().unwrap();
    let start = Instant::now();
    mirror.replace_snapshot(&entries).await.unwrap();
    let unchanged_ms = start.elapsed().as_millis();
    assert_eq!(
        std::fs::metadata(&unchanged).unwrap().modified().unwrap(),
        modified_before
    );
    entries[count - 1] = FolderEntry::Note {
        path: format!("notes/{:05}.md", count - 1),
        markdown: "durable edited fixture".into(),
    };
    let start = Instant::now();
    mirror.replace_snapshot(&entries).await.unwrap();
    let edit_ms = start.elapsed().as_millis();
    assert_eq!(
        std::fs::read_to_string(directory.path().join(format!("notes/{:05}.md", count - 1)))
            .unwrap(),
        "durable edited fixture"
    );
    println!(
        "{{\"notes\":{count},\"create_ms\":{create_ms},\"unchanged_ms\":{unchanged_ms},\"edit_ms\":{edit_ms}}}"
    );
}
