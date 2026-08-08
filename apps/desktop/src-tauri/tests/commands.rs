use std::{future::Future, path::PathBuf, pin::Pin};

use synapse_desktop::commands::{VaultCommands, VaultDialog};
use tempfile::tempdir;

struct TestDialog {
    selection: Option<PathBuf>,
}

impl VaultDialog for TestDialog {
    fn pick_vault(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<PathBuf>, String>> + Send + '_>> {
        Box::pin(async move { Ok(self.selection.clone()) })
    }
}

#[tokio::test]
async fn open_vault_uses_an_injected_dialog_without_a_window() {
    let directory = tempdir().expect("temporary vault directory");
    let commands = VaultCommands::new(TestDialog {
        selection: Some(directory.path().to_path_buf()),
    });

    let opened = commands
        .open_vault()
        .await
        .expect("open vault command succeeds")
        .expect("a directory was selected");

    assert_eq!(
        opened.name,
        directory.path().file_name().unwrap().to_string_lossy()
    );
}
