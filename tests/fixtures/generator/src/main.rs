use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

const DEFAULT_COUNT: usize = 10_000;
const SEED: u64 = 42;

fn main() -> io::Result<()> {
    let mut args = env::args().skip(1);
    let output = PathBuf::from(args.next().unwrap_or_else(|| "target/perf-vault".to_owned()));
    let count = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_COUNT);

    generate_vault(&output, count)?;
    println!(
        "wrote {count} deterministic notes to {} (seed={SEED})",
        output.display()
    );
    Ok(())
}

fn generate_vault(root: &Path, count: usize) -> io::Result<()> {
    if root.exists() {
        fs::remove_dir_all(root)?;
    }
    fs::create_dir_all(root.join("notes"))?;

    let mut manifest = Vec::new();
    for index in 0..count {
        let path = format!("notes/note-{index:05}.md");
        let content = note_content(index, count);
        let absolute = root.join(&path);
        fs::write(&absolute, &content)?;
        let digest = hex(Sha256::digest(content.as_bytes()));
        writeln!(
            &mut manifest,
            "{digest}  {path}  bytes={}",
            content.len()
        )?;
    }
    fs::write(root.join("MANIFEST.sha256"), manifest)?;
    fs::write(
        root.join("README.md"),
        format!(
            "# Performance fixture vault\n\nDeterministic {count} notes, seed={SEED}.\n"
        ),
    )?;
    Ok(())
}

fn note_content(index: usize, count: usize) -> String {
    let next = (index + 1) % count;
    let hop = (index.wrapping_mul(7) + SEED as usize) % count;
    let tag = if index % 5 == 0 { "project" } else { "inbox" };
    let body_repeat = 1 + (index % 9);
    let paragraph = format!(
        "Body for note {index} with keyword token{index} and shared term synapse.\n"
    );
    format!(
        "---\ntags: [{tag}, bench]\n---\n\n# Note {index}\n\nSee [[note-{next:05}]] and [[note-{hop:05}|hop]].\n\n{}",
        paragraph.repeat(body_repeat)
    )
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_notes_are_deterministic() {
        assert_eq!(note_content(0, 10), note_content(0, 10));
        assert_ne!(note_content(0, 10), note_content(1, 10));
        assert!(note_content(3, 10).contains("[[note-00004]]"));
    }
}
