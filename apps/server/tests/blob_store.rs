use std::{collections::HashSet, fs, path::PathBuf};

use synapse_server::blob::{BlobStore, CiphertextHash, FilesystemBlobStore};
use uuid::Uuid;

struct TestStorage {
    path: PathBuf,
}

impl TestStorage {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("synapse-blob-store-{}", Uuid::new_v4()));
        Self { path }
    }
}

impl Drop for TestStorage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn identical_ciphertexts_are_stored_once_and_retrieved_without_decryption() {
    let storage = TestStorage::new();
    let store = FilesystemBlobStore::open(&storage.path).expect("storage opens");
    let ciphertext = b"opaque ciphertext bytes";
    let nonce = b"opaque nonce";
    let hash = CiphertextHash::from_ciphertext(ciphertext);

    store
        .put_ciphertext(ciphertext, nonce, &hash)
        .expect("first ciphertext is stored");
    store
        .put_ciphertext(ciphertext, nonce, &hash)
        .expect("identical ciphertext is deduplicated");

    assert_eq!(
        fs::read_dir(&storage.path)
            .expect("storage directory exists")
            .count(),
        1
    );
    assert!(store.exists(&hash).expect("existence is checked"));

    let stored = store
        .get_ciphertext(&hash)
        .expect("ciphertext is read")
        .expect("ciphertext exists");
    assert_eq!(stored.ciphertext(), ciphertext);
    assert_eq!(stored.nonce(), nonce);
}

#[test]
fn distinct_ciphertexts_are_kept_as_distinct_blobs() {
    let storage = TestStorage::new();
    let store = FilesystemBlobStore::open(&storage.path).expect("storage opens");
    let first_ciphertext = b"first opaque ciphertext";
    let second_ciphertext = b"second opaque ciphertext";
    let first_hash = CiphertextHash::from_ciphertext(first_ciphertext);
    let second_hash = CiphertextHash::from_ciphertext(second_ciphertext);

    store
        .put_ciphertext(first_ciphertext, b"first nonce", &first_hash)
        .expect("first ciphertext is stored");
    store
        .put_ciphertext(second_ciphertext, b"second nonce", &second_hash)
        .expect("second ciphertext is stored");

    assert_ne!(first_hash, second_hash);
    assert_eq!(
        store
            .get_ciphertext(&first_hash)
            .expect("first ciphertext is read")
            .expect("first ciphertext exists")
            .ciphertext(),
        first_ciphertext
    );
    assert_eq!(
        store
            .get_ciphertext(&second_hash)
            .expect("second ciphertext is read")
            .expect("second ciphertext exists")
            .ciphertext(),
        second_ciphertext
    );
}

#[test]
fn rejects_a_declared_hash_that_does_not_match_the_ciphertext() {
    let storage = TestStorage::new();
    let store = FilesystemBlobStore::open(&storage.path).expect("storage opens");
    let ciphertext = b"opaque ciphertext";
    let mismatched_hash = CiphertextHash::from_ciphertext(b"different ciphertext");

    let error = store
        .put_ciphertext(ciphertext, b"nonce", &mismatched_hash)
        .expect_err("mismatched hash is rejected");

    assert_eq!(
        error.to_string(),
        "ciphertext hash does not match ciphertext"
    );
    assert!(
        !store
            .exists(&mismatched_hash)
            .expect("existence is checked")
    );
}

#[test]
fn deletes_only_unreferenced_content_addressed_blobs() {
    let storage = TestStorage::new();
    let store = FilesystemBlobStore::open(&storage.path).expect("storage opens");
    let retained_ciphertext = b"retained ciphertext";
    let deleted_ciphertext = b"deleted ciphertext";
    let retained_hash = CiphertextHash::from_ciphertext(retained_ciphertext);
    let deleted_hash = CiphertextHash::from_ciphertext(deleted_ciphertext);

    store
        .put_ciphertext(retained_ciphertext, b"retained nonce", &retained_hash)
        .expect("retained ciphertext is stored");
    store
        .put_ciphertext(deleted_ciphertext, b"deleted nonce", &deleted_hash)
        .expect("unreferenced ciphertext is stored");

    let references = HashSet::from([retained_hash.clone()]);
    assert_eq!(
        store
            .delete_unreferenced(&references)
            .expect("unreferenced ciphertext is deleted"),
        1
    );
    assert!(
        store
            .exists(&retained_hash)
            .expect("retained blob is checked")
    );
    assert!(
        !store
            .exists(&deleted_hash)
            .expect("deleted blob is checked")
    );
}

#[cfg(unix)]
#[test]
fn rejects_a_symlinked_shard_that_would_escape_the_storage_root() {
    use std::os::unix::fs::symlink;

    let storage = TestStorage::new();
    fs::create_dir_all(&storage.path).expect("storage directory exists");
    let outside = std::env::temp_dir().join(format!("synapse-blob-outside-{}", Uuid::new_v4()));
    fs::create_dir_all(&outside).expect("outside directory exists");
    let ciphertext = b"ciphertext with a symlinked shard";
    let hash = CiphertextHash::from_ciphertext(ciphertext);
    let store = FilesystemBlobStore::open(&storage.path).expect("storage opens");
    store
        .put_ciphertext(ciphertext, b"nonce", &hash)
        .expect("ciphertext is initially stored");
    let shard = fs::read_dir(&storage.path)
        .expect("storage directory is readable")
        .next()
        .expect("shard exists")
        .expect("shard entry is valid")
        .path();
    fs::remove_dir_all(&shard).expect("stored shard is removed before symlink setup");
    symlink(&outside, &shard).expect("shard symlink is created");

    let error = store
        .put_ciphertext(ciphertext, b"nonce", &hash)
        .expect_err("symlink escape is rejected");

    assert_eq!(error.to_string(), "blob storage entry is invalid");
    assert!(
        fs::read_dir(&outside)
            .expect("outside remains readable")
            .next()
            .is_none()
    );
    fs::remove_dir_all(outside).expect("outside directory is removed");
}

#[cfg(unix)]
#[test]
fn creates_private_blob_directories_and_files() {
    use std::os::unix::fs::PermissionsExt;

    let storage = TestStorage::new();
    let store = FilesystemBlobStore::open(&storage.path).expect("storage opens");
    let ciphertext = b"opaque bytes with restrictive permissions";
    let hash = CiphertextHash::from_ciphertext(ciphertext);

    store
        .put_ciphertext(ciphertext, b"nonce", &hash)
        .expect("ciphertext is stored");

    let shard = fs::read_dir(&storage.path)
        .expect("storage directory is readable")
        .next()
        .expect("shard exists")
        .expect("shard entry is valid")
        .path();
    let blob = fs::read_dir(&shard)
        .expect("shard directory is readable")
        .next()
        .expect("blob exists")
        .expect("blob entry is valid")
        .path();
    assert_eq!(
        fs::metadata(&storage.path)
            .expect("root metadata")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(shard)
            .expect("shard metadata")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(blob)
            .expect("blob metadata")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}
