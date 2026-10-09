use std::{fmt, net::SocketAddr, str::FromStr};

use ipnet::IpNet;
use sqlx::postgres::PgConnectOptions;

pub struct ServerConfig {
    bind_address: SocketAddr,
    database_url: String,
    bootstrap_admin: Option<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigError {
    InvalidBindAddress,
    InvalidDatabaseUrl,
    MissingDatabaseUrl,
    InvalidEnvironment,
    InvalidBoolean,
    InvalidOrigin,
    InvalidPublicHost,
    InvalidTrustedProxy,
    InsecureProduction,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidBindAddress => "SYNAPSE_BIND_ADDR must be a socket address",
            Self::InvalidDatabaseUrl => "SYNAPSE_DATABASE_URL must be a valid PostgreSQL URL",
            Self::MissingDatabaseUrl => "SYNAPSE_DATABASE_URL is required",
            Self::InvalidEnvironment => "SYNAPSE_ENV must be exactly development or production",
            Self::InvalidBoolean => "SYNAPSE boolean settings must be true or false",
            Self::InvalidOrigin => "SYNAPSE_ALLOWED_ORIGIN must be an origin URL",
            Self::InvalidPublicHost => "SYNAPSE_PUBLIC_HOST must be a host name",
            Self::InvalidTrustedProxy => "SYNAPSE_TRUSTED_PROXIES contains an invalid network",
            Self::InsecureProduction => {
                "production requires HTTPS, Secure cookies, and closed signup"
            }
        };

        formatter.write_str(message)
    }
}

impl std::error::Error for ConfigError {}

impl ServerConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let mut config = Self::from_values(
            std::env::var("SYNAPSE_BIND_ADDR").ok().as_deref(),
            std::env::var("SYNAPSE_DATABASE_URL").ok().as_deref(),
        )?;
        config.bootstrap_admin = match (
            std::env::var("SYNAPSE_BOOTSTRAP_ADMIN_EMAIL").ok(),
            std::env::var("SYNAPSE_BOOTSTRAP_ADMIN_PASSWORD").ok(),
        ) {
            (Some(email), Some(password)) if !email.is_empty() && !password.is_empty() => {
                Some((email, password))
            }
            _ => None,
        };
        let environment = match std::env::var("SYNAPSE_ENV")
            .unwrap_or_else(|_| "production".to_owned())
            .as_str()
        {
            "development" => Environment::Development,
            "production" => Environment::Production,
            _ => return Err(ConfigError::InvalidEnvironment),
        };
        let allow_public_signup = parse_bool_env("SYNAPSE_ALLOW_PUBLIC_SIGNUP", false)?;
        let cookie_secure = parse_bool_env("SYNAPSE_COOKIE_SECURE", true)?;
        let origin = std::env::var("SYNAPSE_ALLOWED_ORIGIN")
            .unwrap_or_else(|_| "https://synapse.local".to_owned());
        validate_origin(&origin)?;
        let public_host =
            std::env::var("SYNAPSE_PUBLIC_HOST").unwrap_or_else(|_| "notes.example.com".to_owned());
        validate_public_host(&public_host)?;
        if environment == Environment::Production
            && (allow_public_signup || !cookie_secure || !origin.starts_with("https://"))
        {
            return Err(ConfigError::InsecureProduction);
        }
        if let Ok(value) = std::env::var("SYNAPSE_TRUSTED_PROXIES") {
            for entry in value
                .split(',')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
            {
                entry
                    .parse::<IpNet>()
                    .map_err(|_| ConfigError::InvalidTrustedProxy)?;
            }
        }
        if parse_bool_env("SYNAPSE_DEV_FIXTURE", false)? && environment != Environment::Development
        {
            return Err(ConfigError::InsecureProduction);
        }
        Ok(config)
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
            bootstrap_admin: None,
        })
    }

    pub fn bind_address(&self) -> SocketAddr {
        self.bind_address
    }

    pub fn database_url(&self) -> &str {
        &self.database_url
    }

    pub fn take_bootstrap_admin(&mut self) -> Option<(String, String)> {
        self.bootstrap_admin.take()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Production,
}

fn parse_bool_env(name: &str, default: bool) -> Result<bool, ConfigError> {
    match std::env::var(name) {
        Ok(value) if value == "true" => Ok(true),
        Ok(value) if value == "false" => Ok(false),
        Ok(_) => Err(ConfigError::InvalidBoolean),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(std::env::VarError::NotUnicode(_)) => Err(ConfigError::InvalidBoolean),
    }
}

fn validate_origin(origin: &str) -> Result<(), ConfigError> {
    let parsed = url::Url::parse(origin).map_err(|_| ConfigError::InvalidOrigin)?;
    if parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.host_str().is_some()
        && parsed.path() == "/"
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && matches!(parsed.scheme(), "http" | "https")
    {
        Ok(())
    } else {
        Err(ConfigError::InvalidOrigin)
    }
}

fn validate_public_host(host: &str) -> Result<(), ConfigError> {
    if host.is_empty()
        || host
            .bytes()
            .any(|byte| byte < 0x21 || byte == b'/' || byte == b'@')
        || host.contains(['?', '#', ',', '{', '}', '$'])
    {
        return Err(ConfigError::InvalidPublicHost);
    }
    let parsed =
        url::Url::parse(&format!("https://{host}/")).map_err(|_| ConfigError::InvalidPublicHost)?;
    if parsed.host_str() == Some(host)
        && parsed.path() == "/"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && parsed.port().is_none()
    {
        Ok(())
    } else {
        Err(ConfigError::InvalidPublicHost)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_validation_rejects_paths_credentials_and_non_web_schemes() {
        assert!(validate_origin("https://notes.example").is_ok());
        assert!(validate_origin("https://notes.example/app").is_err());
        assert!(validate_origin("https://user:password@notes.example").is_err());
        assert!(validate_origin("file:///tmp/notes").is_err());
    }

    #[test]
    fn public_host_validation_rejects_urls_and_config_injection() {
        assert!(validate_public_host("notes.example.com").is_ok());
        assert!(validate_public_host("localhost").is_ok());
        assert!(validate_public_host("https://notes.example.com").is_err());
        assert!(validate_public_host("notes.example.com/path").is_err());
        assert!(validate_public_host("notes.example.com,evil.example").is_err());
    }
}
