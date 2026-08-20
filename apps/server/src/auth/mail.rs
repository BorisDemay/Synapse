use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::Mutex,
};

use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MailMessage {
    pub to: String,
    pub subject: String,
    pub body: String,
}

#[derive(Debug)]
pub struct MailError;

pub trait Mailer: Send + Sync {
    fn send(&self, message: MailMessage) -> BoxFuture<'_, Result<(), MailError>>;
}

#[derive(Default)]
pub struct RecordingMailer {
    messages: Mutex<Vec<MailMessage>>,
}

impl RecordingMailer {
    pub fn messages(&self) -> Vec<MailMessage> {
        self.messages.lock().expect("mail recording lock").clone()
    }

    pub fn activation_token(&self) -> Option<String> {
        self.messages().into_iter().find_map(|message| {
            message.body.split("token=").nth(1).map(|value| {
                value
                    .split(|ch: char| ch.is_whitespace() || ch == '&')
                    .next()
                    .unwrap_or(value)
                    .to_owned()
            })
        })
    }
}

impl Mailer for RecordingMailer {
    fn send(&self, message: MailMessage) -> BoxFuture<'_, Result<(), MailError>> {
        Box::pin(async move {
            self.messages
                .lock()
                .expect("mail recording lock")
                .push(message);
            Ok(())
        })
    }
}

pub struct DirectoryMailer {
    directory: PathBuf,
}

impl DirectoryMailer {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }
}

impl Mailer for DirectoryMailer {
    fn send(&self, message: MailMessage) -> BoxFuture<'_, Result<(), MailError>> {
        let directory = self.directory.clone();
        Box::pin(async move {
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(|_| MailError)?;
            let path = dump_path(&directory, &message.to);
            let rendered = format!(
                "To: {}\nSubject: {}\n\n{}\n",
                message.to, message.subject, message.body
            );
            tokio::fs::write(path, rendered)
                .await
                .map_err(|_| MailError)
        })
    }
}

pub struct UnavailableMailer;

impl Mailer for UnavailableMailer {
    fn send(&self, _message: MailMessage) -> BoxFuture<'_, Result<(), MailError>> {
        Box::pin(async { Err(MailError) })
    }
}

pub struct SmtpMailer {
    from: Mailbox,
    transport: AsyncSmtpTransport<Tokio1Executor>,
}

impl SmtpMailer {
    pub fn from_env(url: &str, from: &str) -> Option<Self> {
        let from = from.parse().ok()?;
        let transport = AsyncSmtpTransport::<Tokio1Executor>::from_url(url)
            .ok()?
            .build();
        Some(Self { from, transport })
    }
}

impl Mailer for SmtpMailer {
    fn send(&self, message: MailMessage) -> BoxFuture<'_, Result<(), MailError>> {
        let transport = self.transport.clone();
        let from = self.from.clone();
        Box::pin(async move {
            let to: Mailbox = message.to.parse().map_err(|_| MailError)?;
            let email = Message::builder()
                .from(from)
                .to(to)
                .subject(message.subject)
                .body(message.body)
                .map_err(|_| MailError)?;
            transport.send(email).await.map_err(|_| MailError)?;
            Ok(())
        })
    }
}

fn dump_path(directory: &Path, email: &str) -> PathBuf {
    let safe: String = email
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '@' | '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    directory.join(format!("{safe}.eml"))
}

pub fn mailer_from_env() -> std::sync::Arc<dyn Mailer> {
    let from =
        std::env::var("SYNAPSE_MAIL_FROM").unwrap_or_else(|_| "synapse@localhost".to_owned());
    if let Ok(url) = std::env::var("SYNAPSE_SMTP_URL") {
        if !url.is_empty() {
            if let Some(mailer) = SmtpMailer::from_env(&url, &from) {
                return std::sync::Arc::new(mailer);
            }
        }
    }
    if let Ok(directory) = std::env::var("SYNAPSE_MAIL_DIRECTORY") {
        if !directory.is_empty() {
            return std::sync::Arc::new(DirectoryMailer::new(directory));
        }
    }
    if crate::http::security::is_production() {
        std::sync::Arc::new(UnavailableMailer)
    } else {
        std::sync::Arc::new(DirectoryMailer::new("/tmp/synapse-mail"))
    }
}
