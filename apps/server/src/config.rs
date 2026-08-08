use std::{fmt, net::SocketAddr, str::FromStr};

use sqlx::postgres::PgConnectOptions;

pub struct ServerConfig {
    bind_address: SocketAddr,
    database_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigError {
    InvalidBindAddress,
    InvalidDatabaseUrl,
    MissingDatabaseUrl,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidBindAddress => "SYNAPSE_BIND_ADDR must be a socket address",
            Self::InvalidDatabaseUrl => "SYNAPSE_DATABASE_URL must be a valid PostgreSQL URL",
            Self::MissingDatabaseUrl => "SYNAPSE_DATABASE_URL is required",
        };

        formatter.write_str(message)
    }
}

impl std::error::Error for ConfigError {}

impl ServerConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_values(
            std::env::var("SYNAPSE_BIND_ADDR").ok().as_deref(),
            std::env::var("SYNAPSE_DATABASE_URL").ok().as_deref(),
        )
    }

    pub fn from_values(
        bind_address: Option<&str>,
        database_url: Option<&str>,
    ) -> Result<Self, ConfigError> {
        let bind_address = bind_address
            .filter(|value| !value.is_empty())
            .unwrap_or("127.0.0.1:3000")
            .parse()
            .map_err(|_| ConfigError::InvalidBindAddress)?;
        let database_url = database_url
            .filter(|value| !value.is_empty())
            .ok_or(ConfigError::MissingDatabaseUrl)?;
        PgConnectOptions::from_str(database_url).map_err(|_| ConfigError::InvalidDatabaseUrl)?;

        Ok(Self {
            bind_address,
            database_url: database_url.to_owned(),
        })
    }

    pub fn bind_address(&self) -> SocketAddr {
        self.bind_address
    }

    pub fn database_url(&self) -> &str {
        &self.database_url
    }
}
