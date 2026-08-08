use serde_json::Value;
use synapse_core::{NoteId, Revision, VaultId};
use synapse_crypto::{
    Aad, VaultCipher, VaultKey, WrappedVaultKey, unwrap_vault_key, wrap_vault_key,
};

#[test]
fn encrypt_then_decrypts_with_matching_aad() {
    let key = VaultKey::generate();
    let cipher = VaultCipher::new(key);
    let aad = Aad::new(
        VaultId::new(),
        NoteId::new(),
        Revision::new(1).expect("a positive revision"),
    );

    let encrypted = cipher
        .encrypt(&aad, b"# note secrete")
        .expect("encryption succeeds");

    assert_eq!(
        cipher
            .decrypt(&aad, &encrypted)
            .expect("matching AAD decrypts"),
        b"# note secrete"
    );
}

#[test]
fn unwraps_a_vault_key_with_its_passphrase() {
    let key = VaultKey::generate();
    let wrapped = wrap_vault_key(&key, "correct horse battery staple").expect("wrapping succeeds");
    let unwrapped =
        unwrap_vault_key(&wrapped, "correct horse battery staple").expect("unwrapping succeeds");
    let aad = Aad::new(
        VaultId::new(),
        NoteId::new(),
        Revision::new(1).expect("a positive revision"),
    );

    let encrypted = VaultCipher::new(key)
        .encrypt(&aad, b"# note secrete")
        .expect("encryption succeeds");

    assert_eq!(
        VaultCipher::new(unwrapped)
            .decrypt(&aad, &encrypted)
            .expect("unwrapped key decrypts"),
        b"# note secrete"
    );
}

#[test]
fn serializes_a_wrapped_vault_key_deterministically() {
    let wrapped = wrap_vault_key(&VaultKey::generate(), "correct horse battery staple")
        .expect("wrapping succeeds");

    let first = wrapped.to_json().expect("serialization succeeds");
    let second = wrapped.to_json().expect("serialization succeeds");
    let restored = WrappedVaultKey::from_json(&first).expect("valid envelope deserializes");

    assert_eq!(first, second);
    assert!(unwrap_vault_key(&restored, "correct horse battery staple").is_ok());
}

#[test]
fn rejects_a_wrong_passphrase_for_a_wrapped_vault_key() {
    let wrapped = wrap_vault_key(&VaultKey::generate(), "correct horse battery staple")
        .expect("wrapping succeeds");

    assert!(unwrap_vault_key(&wrapped, "incorrect passphrase").is_err());
}

#[test]
fn rejects_content_decryption_when_aad_changes() {
    let cipher = VaultCipher::new(VaultKey::generate());
    let vault_id = VaultId::new();
    let aad = Aad::new(
        vault_id.clone(),
        NoteId::new(),
        Revision::new(1).expect("a positive revision"),
    );
    let altered_aad = Aad::new(
        vault_id,
        NoteId::new(),
        Revision::new(1).expect("a positive revision"),
    );
    let encrypted = cipher
        .encrypt(&aad, b"# note secrete")
        .expect("encryption succeeds");

    assert!(cipher.decrypt(&altered_aad, &encrypted).is_err());
}

#[test]
fn debug_output_does_not_disclose_a_vault_key_or_plaintext() {
    let key = VaultKey::generate();
    let cipher = VaultCipher::new(VaultKey::generate());
    let aad = Aad::new(
        VaultId::new(),
        NoteId::new(),
        Revision::new(1).expect("a positive revision"),
    );
    let encrypted = cipher
        .encrypt(&aad, b"# note secrete")
        .expect("encryption succeeds");

    assert!(!format!("{key:?}").contains("note secrete"));
    assert!(!format!("{encrypted:?}").contains("note secrete"));
}

#[test]
fn rejects_a_tampered_wrapped_vault_key() {
    let wrapped = wrap_vault_key(&VaultKey::generate(), "correct horse battery staple")
        .expect("wrapping succeeds");
    let mut serialized: Value =
        serde_json::from_slice(&wrapped.to_json().expect("serialization succeeds"))
            .expect("valid JSON");
    let first_byte = serialized["ciphertext"][0]
        .as_u64()
        .expect("ciphertext has a first byte");
    serialized["ciphertext"][0] = Value::from(first_byte ^ 1);
    let tampered = WrappedVaultKey::from_json(
        &serde_json::to_vec(&serialized).expect("serialization succeeds"),
    )
    .expect("shape remains valid");

    assert!(unwrap_vault_key(&tampered, "correct horse battery staple").is_err());
}
