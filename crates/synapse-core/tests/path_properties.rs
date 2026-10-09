use proptest::prelude::*;
use synapse_core::VaultAssetPath;

proptest! {
    #[test]
    fn accepted_attachment_paths_are_relative_non_executable_and_normalized(input in ".{0,256}") {
        if let Ok(path) = VaultAssetPath::parse(&input) {
            let value = path.as_str();
            prop_assert!(value.starts_with("attachments/"));
            prop_assert!(!value.starts_with('/'));
            prop_assert!(!value.contains(".."));
            prop_assert!(!value.contains('\\'));
            for extension in [".exe", ".bat", ".cmd", ".com", ".scr", ".ps1", ".dll", ".so"] {
                prop_assert!(!value.to_ascii_lowercase().ends_with(extension));
            }
        }
    }
}
