#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedNote {
    pub source: String,
    pub tags: Vec<String>,
    pub title: Option<String>,
    pub wikilinks: Vec<WikiLink>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WikiLink {
    pub target: String,
    pub alias: Option<String>,
}

const MAX_DOCUMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_FRONT_MATTER_BYTES: usize = 64 * 1024;
const MAX_WIKILINKS: usize = 1024;
const MAX_WIKILINK_BYTES: usize = 4 * 1024;
const MAX_TAGS: usize = 256;
const MAX_TAG_BYTES: usize = 256;

pub fn parse_note(source: &str) -> Result<ParsedNote, NoteParseError> {
    if source.len() > MAX_DOCUMENT_BYTES {
        return Err(NoteParseError::DocumentTooLarge);
    }

    let mut wikilinks = Vec::new();
    let (front_matter, body) = split_front_matter(source)?;
    let mut fence = None;
    let mut title = None;

    for line in body.lines() {
        if let Some((fence_character, fence_length)) = fence {
            if is_closing_fence(line, fence_character, fence_length) {
                fence = None;
            }
            continue;
        }

        if let Some(opening_fence) = opening_fence(line) {
            fence = Some(opening_fence);
        } else {
            if title.is_none() {
                title = line.strip_prefix("# ").map(str::to_owned);
            }
            extract_wikilinks(line, &mut wikilinks)?;
        }
    }

    Ok(ParsedNote {
        source: source.to_owned(),
        tags: extract_tags(front_matter)?,
        title,
        wikilinks,
    })
}

pub fn parse_note_bytes(source: &[u8]) -> Result<ParsedNote, NoteParseError> {
    let source = std::str::from_utf8(source).map_err(|_| NoteParseError::InvalidUtf8)?;
    parse_note(source)
}

fn opening_fence(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    let fence_character = trimmed.chars().next()?;
    if !matches!(fence_character, '`' | '~') {
        return None;
    }

    let fence_length = trimmed
        .chars()
        .take_while(|character| *character == fence_character)
        .count();
    (fence_length >= 3).then_some((fence_character, fence_length))
}

fn is_closing_fence(line: &str, fence_character: char, opening_length: usize) -> bool {
    let trimmed = line.trim_start();
    let fence_length = trimmed
        .chars()
        .take_while(|character| *character == fence_character)
        .count();

    fence_length >= opening_length && trimmed[fence_length..].trim().is_empty()
}

fn split_front_matter(source: &str) -> Result<(&str, &str), NoteParseError> {
    let Some(after_opening) = source.strip_prefix("---\n") else {
        return Ok(("", source));
    };

    let search_end = after_opening.floor_char_boundary(
        after_opening
            .len()
            .min(MAX_FRONT_MATTER_BYTES.saturating_add("\n---\n".len())),
    );
    let bounded_front_matter = &after_opening[..search_end];
    let closing_delimiter = bounded_front_matter
        .find("\n---\n")
        .map(|end| (end, end + "\n---\n".len()))
        .or_else(|| {
            (search_end == after_opening.len() && bounded_front_matter.ends_with("\n---"))
                .then_some((
                    bounded_front_matter.len() - "\n---".len(),
                    bounded_front_matter.len(),
                ))
        });
    let Some((end, body_start)) = closing_delimiter else {
        return Err(if after_opening.len() > MAX_FRONT_MATTER_BYTES {
            NoteParseError::FrontMatterTooLarge
        } else {
            NoteParseError::UnclosedFrontMatter
        });
    };

    Ok((&after_opening[..end], &after_opening[body_start..]))
}

fn extract_tags(front_matter: &str) -> Result<Vec<String>, NoteParseError> {
    let mut tags = Vec::new();
    let mut reading_tags = false;

    for line in front_matter.lines() {
        if let Some(inline_tags) = line
            .strip_prefix("tags: [")
            .and_then(|value| value.strip_suffix(']'))
        {
            for tag in inline_tags
                .split(',')
                .map(str::trim)
                .filter(|tag| !tag.is_empty())
            {
                push_tag(&mut tags, tag)?;
            }
            return Ok(tags);
        }
        if line == "tags:" {
            reading_tags = true;
            continue;
        }
        if reading_tags {
            if let Some(tag) = line.trim().strip_prefix("- ") {
                push_tag(&mut tags, tag)?;
            } else if !line.starts_with(char::is_whitespace) {
                break;
            }
        }
    }

    Ok(tags)
}

fn push_tag(tags: &mut Vec<String>, tag: &str) -> Result<(), NoteParseError> {
    if tag.len() > MAX_TAG_BYTES {
        return Err(NoteParseError::TagTooLong);
    }
    if tags.len() == MAX_TAGS {
        return Err(NoteParseError::TooManyTags);
    }

    tags.push(tag.to_owned());
    Ok(())
}

fn extract_wikilinks(source: &str, wikilinks: &mut Vec<WikiLink>) -> Result<(), NoteParseError> {
    let mut remainder = source;

    while let Some(start) = remainder.find("[[") {
        let escaped = remainder[..start]
            .bytes()
            .rev()
            .take_while(|byte| *byte == b'\\')
            .count()
            % 2
            == 1;
        let after_start = &remainder[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let raw_link = &after_start[..end];
        if raw_link.len() > MAX_WIKILINK_BYTES {
            return Err(NoteParseError::WikiLinkTooLong);
        }
        let (target, alias) = match raw_link.split_once('|') {
            Some((target, alias)) => (target, Some(alias)),
            None => (raw_link, None),
        };

        if !escaped && !target.is_empty() {
            if wikilinks.len() == MAX_WIKILINKS {
                return Err(NoteParseError::TooManyWikiLinks);
            }
            wikilinks.push(WikiLink {
                target: target.to_owned(),
                alias: alias.map(str::to_owned),
            });
        }

        remainder = &after_start[end + 2..];
    }

    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NoteParseError {
    InvalidUtf8,
    DocumentTooLarge,
    FrontMatterTooLarge,
    UnclosedFrontMatter,
    TooManyWikiLinks,
    WikiLinkTooLong,
    TooManyTags,
    TagTooLong,
}
