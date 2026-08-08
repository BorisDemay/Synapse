use crate::{VaultMutation, VaultOrchestrator, VaultOrchestratorResult};

impl VaultOrchestrator {
    /// Completes the SQLite half of a mutation after a process interruption
    /// between the atomic filesystem rename and SQLite commit.
    pub async fn recover_mutation(
        &mut self,
        mutation: &VaultMutation,
    ) -> VaultOrchestratorResult<()> {
        self.persist_existing_file(mutation).await
    }
}
