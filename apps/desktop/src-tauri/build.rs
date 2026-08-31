fn main() {
    println!("cargo:rerun-if-env-changed=SYNAPSE_UPDATER_PUBLIC_KEY");
    if std::env::var("SYNAPSE_UPDATER_PUBLIC_KEY").is_ok_and(|key| key.trim().is_empty()) {
        panic!("SYNAPSE_UPDATER_PUBLIC_KEY must not be empty when configured");
    }
    tauri_build::build()
}
