use synapse_core::{NoteParseError, parse_note, parse_note_bytes};

#[test]
fn extracts_wikilinks_without_changing_source() {
    let source = "# Projet\nVoir [[Roadmap|la feuille de route]].";

    let parsed = parse_note(source).unwrap();

    assert_eq!(parsed.wikilinks[0].target, "Roadmap");
    assert_eq!(
        parsed.wikilinks[0].alias.as_deref(),
        Some("la feuille de route")
    );
    assert_eq!(parsed.source, source);
}

#[test]
fn ignores_wikilinks_inside_fenced_code_blocks() {
    let source = "```md\n[[Not a link]]\n```\n[[A real link]]";

    let parsed = parse_note(source).unwrap();

    assert_eq!(parsed.wikilinks.len(), 1);
    assert_eq!(parsed.wikilinks[0].target, "A real link");
}

#[test]
fn ignores_wikilinks_inside_tilde_fences() {
    let source = "~~~markdown\n[[Not a link]]\n~~~\n[[A real link]]";

    let parsed = parse_note(source).unwrap();

    assert_eq!(parsed.wikilinks.len(), 1);
    assert_eq!(parsed.wikilinks[0].target, "A real link");
}

#[test]
fn closes_fences_only_with_the_opening_character_and_length() {
    let source = "````markdown\n```\n[[Still code]]\n~~~~\n[[Also code]]\n````\n[[A real link]]";

    let parsed = parse_note(source).unwrap();

    assert_eq!(parsed.wikilinks.len(), 1);
    assert_eq!(parsed.wikilinks[0].target, "A real link");
}

#[test]
fn ignores_titles_inside_fenced_code_blocks() {
    let source = "~~~markdown\n# Not the title\n~~~\n# Projet";

    let parsed = parse_note(source).unwrap();

    assert_eq!(parsed.title.as_deref(), Some("Projet"));
}

#[test]
fn ignores_escaped_wikilinks() {
    let parsed = parse_note("\\[[Not a link]] and [[A real link]]").unwrap();

    assert_eq!(parsed.wikilinks.len(), 1);
    assert_eq!(parsed.wikilinks[0].target, "A real link");
}

#[test]
fn parses_wikilinks_after_an_even_number_of_backslashes() {
    let parsed = parse_note("\\\\[[A real link]]").unwrap();

    assert_eq!(parsed.wikilinks.len(), 1);
    assert_eq!(parsed.wikilinks[0].target, "A real link");
}

#[test]
fn rejects_more_than_one_thousand_and_twenty_four_wikilinks() {
    let source = "[[a]]".repeat(1025);

    assert_eq!(parse_note(&source), Err(NoteParseError::TooManyWikiLinks));
}

#[test]
fn rejects_wikilinks_larger_than_four_kibibytes() {
    let source = format!("[[{}]]", "a".repeat(4 * 1024 + 1));

    assert_eq!(parse_note(&source), Err(NoteParseError::WikiLinkTooLong));
}

#[test]
fn extracts_bounded_front_matter_tags_and_title() {
    let source = "---\ntags:\n  - synapse\n  - local-first\n---\n# Projet";

    let parsed = parse_note(source).unwrap();

    assert_eq!(parsed.title.as_deref(), Some("Projet"));
    assert_eq!(parsed.tags, ["synapse", "local-first"]);
}

#[test]
fn accepts_front_matter_closed_at_end_of_file() {
    let parsed = parse_note("---\ntags: [synapse]\n---").unwrap();

    assert_eq!(parsed.tags, ["synapse"]);
}

#[test]
fn rejects_unclosed_front_matter() {
    let source = "---\ntags:\n  - synapse";

    assert_eq!(parse_note(source), Err(NoteParseError::UnclosedFrontMatter));
}

#[test]
fn rejects_front_matter_larger_than_sixty_four_kibibytes() {
    let source = format!("---\n{}\n---\n# Projet", "a".repeat(64 * 1024 + 1));

    assert!(matches!(
        parse_note(&source),
        Err(NoteParseError::FrontMatterTooLarge)
    ));
}

#[test]
fn extracts_unicode_inline_tags() {
    let parsed = parse_note("---\ntags: [équipe, recherche]\n---\n# Projet").unwrap();

    assert_eq!(parsed.tags, ["équipe", "recherche"]);
}

#[test]
fn rejects_more_than_two_hundred_and_fifty_six_tags() {
    let tags = (0..257)
        .map(|index| format!("  - tag-{index}"))
        .collect::<Vec<_>>()
        .join("\n");
    let source = format!("---\ntags:\n{tags}\n---\n# Projet");

    assert_eq!(parse_note(&source), Err(NoteParseError::TooManyTags));
}

#[test]
fn rejects_tags_larger_than_two_hundred_and_fifty_six_bytes() {
    let source = format!("---\ntags: [{}]\n---\n# Projet", "a".repeat(257));

    assert_eq!(parse_note(&source), Err(NoteParseError::TagTooLong));
}

#[test]
fn rejects_documents_larger_than_ten_mebibytes() {
    let source = "a".repeat(10 * 1024 * 1024 + 1);

    assert!(parse_note(&source).is_err());
}

#[test]
fn rejects_invalid_utf8_at_the_byte_boundary() {
    assert_eq!(
        parse_note_bytes(&[b'#', b' ', 0xff]),
        Err(NoteParseError::InvalidUtf8)
    );
}
