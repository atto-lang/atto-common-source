//! Offline recovery inventory integrity only: never queries or certifies GitHub issue state.
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;

const SECTIONS: [&str; 5] = [
    "Security / provenance",
    "CI / executable evidence",
    "Actors / runtime concurrency",
    "Language / types / native",
    "CLI / contracts / orphan work",
];
const ISSUE_PREFIX: &str = "https://github.com/ores-truffle-oreslang/";

fn parse_issue(row: &str) -> Option<String> {
    let body = row.strip_prefix("- [ ] **")?;
    let (title, link) = body.split_once("** — [")?;
    if title.trim().is_empty() {
        return None;
    }
    let (caption, link) = link.split_once("](")?;
    if caption.is_empty() || caption.contains(']') || caption.contains('\n') {
        return None;
    }
    let link = link.strip_prefix(ISSUE_PREFIX)?;
    let (repo, suffix) = link.split_once("/issues/")?;
    if repo.is_empty()
        || !repo
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return None;
    }
    let (number, next) = suffix.split_once("). Next: ")?;
    if number.is_empty()
        || number.starts_with('0')
        || !number.bytes().all(|b| b.is_ascii_digit())
        || next.trim().is_empty()
        || next.contains('\n')
    {
        return None;
    }
    Some(format!("{}#{number}", repo.to_ascii_lowercase()))
}

fn verify_register(document: &str) -> Vec<String> {
    let mut problems = Vec::new();
    if !document
        .lines()
        .next()
        .is_some_and(|line| line.contains("October 6–15, 2026"))
    {
        problems.push("register heading must describe the October 6–15 window".into());
    }
    if document.matches("\n## ").count() < SECTIONS.len() {
        problems.push("missing recovery sections".into());
    }
    let mut ids = HashSet::new();
    let mut total_rows = 0;
    let mut previous = None;
    for heading in SECTIONS {
        let marker = format!("\n## {heading}\n");
        if document.matches(marker.as_str()).count() != 1 {
            problems.push(format!("missing or repeated section: {heading}"));
            continue;
        }
        let start = document.find(marker.as_str()).unwrap();
        if previous.is_some_and(|p| start <= p) {
            problems.push(format!("incorrect section order: {heading}"));
        }
        previous = Some(start);
        let remaining = &document[start + marker.len()..];
        let section = remaining.split("\n## ").next().unwrap_or("");
        let rows: Vec<&str> = section
            .lines()
            .filter(|line| {
                line.starts_with("- [ ]") || line.starts_with("- [x]") || line.starts_with("- [X]")
            })
            .collect();
        if rows.len() != 10 {
            problems.push(format!(
                "{heading}: expected 10 open issue rows, found {}",
                rows.len()
            ));
        }
        total_rows += rows.len();
        for row in rows {
            match parse_issue(row) {
                Some(id) => {
                    if !ids.insert(id.clone()) {
                        problems.push(format!("duplicate issue reference: {id}"));
                    }
                }
                None => {
                    problems.push(format!(
                        "{heading}: invalid/open-task row: {}",
                        row.chars().take(120).collect::<String>()
                    ));
                }
            }
        }
    }
    if total_rows != 50 {
        problems.push(format!(
            "expected exactly 50 checklist rows, found {total_rows}"
        ));
    }
    if ids.len() != 50 {
        problems.push(format!(
            "expected 50 unique GitHub issue references, found {}",
            ids.len()
        ));
    }
    problems
}

fn main() {
    let mut args = env::args_os().skip(1);
    let path = match args.next() {
        Some(path) if args.next().is_none() => PathBuf::from(path),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/UNFINISHED_WORK_RECOVERY_2026-10-15.md"),
        _ => {
            eprintln!("usage: oreslang-recovery-register [register.md]");
            std::process::exit(2)
        }
    };
    let input = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(e) => {
            eprintln!("cannot read register {}: {e}", path.display());
            std::process::exit(2);
        }
    };
    let errors = verify_register(&input);
    if !errors.is_empty() {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    }
    println!("50 unique open-task references; five sections x 10; integrity OK");
    println!("(live GitHub issue state and executable test evidence NOT checked)");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        let mut lines = vec![
            "# Recovery audit: 50 unfinished Oreslang tasks (October 6–15, 2026)".to_string(),
            String::new(),
        ];
        for (section_idx, heading) in SECTIONS.iter().enumerate() {
            lines.push(format!("## {heading}"));
            lines.push(String::new());
            for idx in 0..10 {
                let n = 1000 + section_idx * 10 + idx;
                lines.push(format!(
                    "- [ ] **Work item {n}** — [repo#{n}](https://github.com/ores-truffle-oreslang/repo/issues/{n}). Next: Require an exact-head executable proof."
                ));
            }
            lines.push(String::new());
        }
        lines.join("\n")
    }

    #[test]
    fn full_inventory_admits_exactly_fifty_distinct_references() {
        assert_eq!(verify_register(&fixture()), Vec::<String>::new());
    }

    #[test]
    fn rejects_duplicate_and_case_aliased_ids() {
        let duplicated = fixture().replace("repo/issues/1011", "repo/issues/1010");
        assert!(verify_register(&duplicated)
            .iter()
            .any(|e| e.contains("duplicate issue")));
        let aliased = fixture().replace(
            "github.com/ores-truffle-oreslang/repo/issues/1011",
            "github.com/ores-truffle-oreslang/REPO/issues/1010",
        );
        assert!(verify_register(&aliased)
            .iter()
            .any(|e| e.contains("duplicate issue")));
    }

    #[test]
    fn rejects_checked_completed_and_pulls() {
        let checked = fixture().replace("- [ ] **Work item 1000**", "- [x] **Work item 1000**");
        assert!(!verify_register(&checked).is_empty());
        let pull = fixture().replace("repo/issues/1000", "repo/pull/1000");
        assert!(!verify_register(&pull).is_empty());
    }

    #[test]
    fn rejects_omissions_invalid_date_and_section_reorder() {
        assert!(!verify_register("").is_empty());
        let absent = fixture().replace("repo/issues/1034", "repo/issues/1033");
        assert!(!verify_register(&absent).is_empty());
        let wrong = fixture().replace("October 6–15", "October 5–15");
        assert!(!verify_register(&wrong).is_empty());
        let missing = fixture().replace("## CI / executable evidence", "## Different heading");
        assert!(!verify_register(&missing).is_empty());
    }

    #[test]
    fn rejects_empty_action_and_extra_trailing_text() {
        let no_action = fixture().replace(
            "repo/issues/1000). Next: Require an exact-head executable proof.",
            "repo/issues/1000). Next: ",
        );
        assert!(!verify_register(&no_action).is_empty());
        assert_eq!(
            parse_issue(
                "- [ ] **x** — [a](https://github.com/ores-truffle-oreslang/r/issues/0). Next: y"
            ),
            None
        );
    }

    #[test]
    fn actual_checked_in_recovery_register_still_matches() {
        assert!(verify_register(include_str!(
            "../../../docs/UNFINISHED_WORK_RECOVERY_2026-10-15.md"
        ))
        .is_empty());
    }
}
