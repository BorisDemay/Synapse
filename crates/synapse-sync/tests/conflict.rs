use synapse_sync::conflict::{
    CiphertextCodec, ConflictError, ConflictOutcome, EncryptedVariant, record_manual_resolution,
    resolve,
};

struct TestCodec;

impl CiphertextCodec for TestCodec {
    fn decrypt(&self, ciphertext: &EncryptedVariant) -> Result<Vec<u8>, ConflictError> {
        Ok(ciphertext.ciphertext.clone())
    }

    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, ConflictError> {
        Ok(plaintext.to_vec())
    }
}

#[test]
fn disjoint_three_way_edits_are_decrypted_merged_and_reencrypted_as_a_new_revision() {
    let base = EncryptedVariant {
        revision: 1,
        ciphertext: b"alpha\nbeta\ngamma\n".to_vec(),
    };
    let local = EncryptedVariant {
        revision: 1,
        ciphertext: b"local-alpha\nbeta\ngamma\n".to_vec(),
    };
    let remote = EncryptedVariant {
        revision: 2,
        ciphertext: b"alpha\nbeta\nremote-gamma\n".to_vec(),
    };

    let outcome = resolve(&TestCodec, base, local, remote).expect("variants decrypt");

    assert_eq!(
        outcome,
        ConflictOutcome::AutomaticResolution {
            revision: 3,
            ciphertext: b"local-alpha\nbeta\nremote-gamma\n".to_vec(),
        }
    );
}

#[test]
fn overlapping_edits_preserve_all_encrypted_variants_for_manual_resolution() {
    let base = EncryptedVariant {
        revision: 4,
        ciphertext: b"one\ntwo\nthree\n".to_vec(),
    };
    let local = EncryptedVariant {
        revision: 4,
        ciphertext: b"one\nlocal-two\nthree\n".to_vec(),
    };
    let remote = EncryptedVariant {
        revision: 5,
        ciphertext: b"one\nremote-two\nthree\n".to_vec(),
    };

    let outcome =
        resolve(&TestCodec, base.clone(), local.clone(), remote.clone()).expect("variants decrypt");

    assert_eq!(
        outcome,
        ConflictOutcome::ManualResolutionRequired {
            base,
            local,
            remote,
        }
    );
}

#[test]
fn manual_resolution_creates_an_auditable_encrypted_revision_after_the_remote_history() {
    let outcome =
        record_manual_resolution(&TestCodec, 5, b"resolved-by-user").expect("resolution encrypts");

    assert_eq!(
        outcome,
        ConflictOutcome::AutomaticResolution {
            revision: 6,
            ciphertext: b"resolved-by-user".to_vec(),
        }
    );
}
