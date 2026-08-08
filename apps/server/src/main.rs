use std::fmt;

use sqlx::postgres::PgPoolOptions;
use synapse_server::{config::ServerConfig, router, run_migrations};

#[derive(Debug)]
enum StartupError {
    Configuration,
    Database,
    Migration,
    Bind,
    Serve,
}

impl fmt::Display for StartupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Configuration => "server configuration is invalid",
            Self::Database => "database connection failed",
            Self::Migration => "database migration failed",
            Self::Bind => "server bind failed",
            Self::Serve => "server terminated unexpectedly",
        };

        formatter.write_str(message)
    }
}

impl std::error::Error for StartupError {}

#[tokio::main]
async fn main() -> Result<(), StartupError> {
    let config = ServerConfig::from_env().map_err(|_| StartupError::Configuration)?;
    let pool = PgPoolOptions::new()
        .connect(config.database_url())
        .await
        .map_err(|_| StartupError::Database)?;
    run_migrations(&pool)
        .await
        .map_err(|_| StartupError::Migration)?;
    let listener = tokio::net::TcpListener::bind(config.bind_address())
        .await
        .map_err(|_| StartupError::Bind)?;

    axum::serve(listener, router(Some(pool)))
        .await
        .map_err(|_| StartupError::Serve)
}
