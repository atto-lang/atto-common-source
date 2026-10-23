//! Executable reference normalizer for the first Oreslang refinement subset.
//! This is a conformance oracle, not an Oreslang compiler or runtime.

use regex::Regex;
use std::{collections::BTreeSet, sync::OnceLock};

const MIN_I64: i128 = i64::MIN as i128;
const MAX_I64: i128 = i64::MAX as i128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConstraintSyntaxError(pub String);

impl std::fmt::Display for ConstraintSyntaxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}
impl std::error::Error for ConstraintSyntaxError {}

fn syntax(msg: impl Into<String>) -> ConstraintSyntaxError {
    ConstraintSyntaxError(msg.into())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Property {
    Length,
    Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Predicate {
    pub property: Property,
    pub op: Op,
    pub bound: i64,
}

impl Predicate {
    fn holds_i128(&self, actual: i128) -> bool {
        let bound = self.bound as i128;
        match self.op {
            Op::Eq => actual == bound,
            Op::Ne => actual != bound,
            Op::Gt => actual > bound,
            Op::Gte => actual >= bound,
            Op::Lt => actual < bound,
            Op::Lte => actual <= bound,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Base {
    String,
    Int,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Candidate<'a> {
    Str(&'a str),
    Int(i128),
    Bool(bool),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharPolicy {
    Any,
    AsciiLetters,
    AsciiUppercase,
    AsciiLowercase,
    UnicodeUppercase,
    UnicodeLowercase,
    Han,
}

// Unicode 18.0.0 Script=Han, Scripts.txt (2026-06-29), 25 ranges
// covering exactly 103352 code points, not a Chinese language classifier.
// https://www.unicode.org/Public/18.0.0/ucd/Scripts.txt
const HAN18_RANGES: &[(u32, u32)] = &[
    (11904, 11929),
    (11931, 12019),
    (12032, 12245),
    (12293, 12293),
    (12295, 12295),
    (12321, 12329),
    (12344, 12346),
    (12347, 12347),
    (13312, 19903),
    (19968, 40959),
    (63744, 64109),
    (64112, 64217),
    (94178, 94178),
    (94179, 94179),
    (94192, 94193),
    (94194, 94195),
    (94196, 94198),
    (131072, 173791),
    (173824, 178206),
    (178208, 183981),
    (183984, 191456),
    (191472, 192093),
    (194560, 195101),
    (196608, 201546),
    (201552, 210041),
];

fn ucd18_han(codepoint: u32) -> bool {
    HAN18_RANGES.iter().any(|&(start, stop)| (start..=stop).contains(&codepoint))
}

impl CharPolicy {
    fn accepts(self, value: &str) -> bool {
        match self {
            Self::Any => true,
            Self::AsciiLetters => value.bytes().all(|b| b.is_ascii_alphabetic()),
            Self::AsciiUppercase => value.bytes().all(|b| b.is_ascii_uppercase()),
            Self::AsciiLowercase => value.bytes().all(|b| b.is_ascii_lowercase()),
            // Host Unicode casing tables are not pinned to version 18.
            Self::UnicodeUppercase | Self::UnicodeLowercase => false,
            Self::Han => value.chars().all(|ch| ucd18_han(ch as u32)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refined {
    pub name: String,
    pub base: Base,
    pub nominal: bool,
    pub predicates: Vec<Predicate>,
    pub char_policy: CharPolicy,
}

impl Refined {
    pub fn accepts(&self, value: Candidate<'_>) -> bool {
        let actual = match (self.base, value) {
            (Base::String, Candidate::Str(s)) => s.chars().count() as i128,
            (Base::Int, Candidate::Int(n)) if (MIN_I64..=MAX_I64).contains(&n) => n,
            (_, Candidate::Bool(_)) => return false,
            _ => return false,
        };
        self.predicates.iter().all(|p| p.holds_i128(actual))
            && match value {
                Candidate::Str(text) => self.char_policy.accepts(text),
                _ => self.char_policy == CharPolicy::Any,
            }
    }

    pub fn entails(&self, other: &Self) -> bool {
        if self.base != other.base {
            return false;
        }
        if self.char_policy != other.char_policy && other.char_policy != CharPolicy::Any {
            return false;
        }
        if (self.nominal || other.nominal)
            && !(self.nominal && other.nominal && self.name == other.name)
        {
            return false;
        }
        let Ok((lo, hi, excluded)) = bounds(&self.predicates, self.base) else {
            return false;
        };
        let Ok((other_lo, other_hi, other_excluded)) = bounds(&other.predicates, other.base) else {
            return false;
        };
        if lo < other_lo || hi > other_hi {
            return false;
        }
        other_excluded
            .iter()
            .all(|n| !((lo..=hi).contains(n) && !excluded.contains(n)))
    }
}

fn cmp_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^\s*(length|value)\s*(eq|ne|gte|lte|gt|lt|==|!=|>=|<=|>|<)\s*(-?[0-9]+(?:_[0-9]+)*)\s*$").unwrap())
}
fn short_bound_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^\s*(min|max)\s+(-?[0-9]+(?:_[0-9]+)*)\s*$").unwrap())
}
fn short_length_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^\s*(min_length|max_length)\s+(-?[0-9]+(?:_[0-9]+)*)\s*$").unwrap())
}
fn char_policy_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^\s*chars\s+(ascii_letters|ascii_uppercase|ascii_lowercase|uppercase|lowercase|han)\s*$").unwrap())
}
fn decl_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?s)^\s*(?:(?:define\s+(?:pub\s+)?)|(?:pub\s+define\s+))?type\s+([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(string|int)\s*(?:with\s+(.+))?\s*;\s*$").unwrap())
}
fn newtype_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?s)^\s*define\s+newtype\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(\s*(string|int)\s*\)\s*(?:with\s+(.+))?\s*;\s*$").unwrap())
}
fn ann_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^@(?:(?P<name>Size|Length|MinLength|MaxLength|Min|Max|Range)\s*\((?P<args>[^()]*)\)\s*|(?P<notempty>NotEmpty)\s*)").unwrap())
}
fn arg_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^\s*(min|max|eq)\s*=\s*(-?[0-9]+(?:_[0-9]+)*)\s*$").unwrap())
}
fn positional_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^\s*(-?[0-9]+(?:_[0-9]+)*)\s*$").unwrap())
}
fn and_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\s+and\s+").unwrap())
}

fn parse_bound(token: &str) -> Result<i64, ConstraintSyntaxError> {
    let normalized = token.replace('_', "");
    let n = normalized
        .parse::<i128>()
        .map_err(|_| syntax("invalid integer bound"))?;
    if !(MIN_I64..=MAX_I64).contains(&n) {
        return Err(syntax("refinement bound outside signed int64"));
    }
    Ok(n as i64)
}

fn bounds(
    predicates: &[Predicate],
    base: Base,
) -> Result<(i128, i128, BTreeSet<i128>), ConstraintSyntaxError> {
    let mut lo = if base == Base::String { 0 } else { MIN_I64 };
    let mut hi = MAX_I64;
    let mut excluded = BTreeSet::new();

    for p in predicates {
        let n = p.bound as i128;
        match p.op {
            Op::Eq => {
                lo = lo.max(n);
                hi = hi.min(n);
            }
            Op::Ne => {
                excluded.insert(n);
            }
            Op::Gt => {
                lo = lo.max(n + 1);
            }
            Op::Gte => {
                lo = lo.max(n);
            }
            Op::Lt => {
                hi = hi.min(n - 1);
            }
            Op::Lte => {
                hi = hi.min(n);
            }
        }
    }

    if lo > hi {
        return Err(syntax("unsatisfiable refinement"));
    }

    excluded.retain(|n| (lo..=hi).contains(n));
    if lo == hi && excluded.contains(&lo) {
        return Err(syntax("unsatisfiable refinement"));
    }

    let domain_size = hi - lo + 1;
    if domain_size <= excluded.len() as i128 {
        let mut exhausted = true;
        for offset in 0..domain_size as usize {
            if !excluded.contains(&(lo + offset as i128)) {
                exhausted = false;
                break;
            }
        }
        if exhausted {
            return Err(syntax("unsatisfiable excluded interval"));
        }
    }

    Ok((lo, hi, excluded))
}

fn op_alias(value: &str) -> Option<Op> {
    match value {
        "eq" | "==" => Some(Op::Eq),
        "ne" | "!=" => Some(Op::Ne),
        "gt" | ">" => Some(Op::Gt),
        "gte" | ">=" => Some(Op::Gte),
        "lt" | "<" => Some(Op::Lt),
        "lte" | "<=" => Some(Op::Lte),
        _ => None,
    }
}

fn property(value: &str) -> Option<Property> {
    match value {
        "length" => Some(Property::Length),
        "value" => Some(Property::Value),
        _ => None,
    }
}

fn base(value: &str) -> Option<Base> {
    match value {
        "string" => Some(Base::String),
        "int" => Some(Base::Int),
        _ => None,
    }
}

pub fn parse(source: &str) -> Result<Refined, ConstraintSyntaxError> {
    let mut source = source.trim();
    let mut annotations = Vec::new();

    while source.starts_with('@') {
        let Some(caps) = ann_re().captures(source) else {
            return Err(syntax("unsupported annotation"));
        };
        let matched = caps.get(0).unwrap();
        let consumed = matched.end();
        if caps.name("notempty").is_some() {
            annotations.push(Predicate {
                property: Property::Length,
                op: Op::Gt,
                bound: 0,
            });
            source = source[consumed..].trim_start();
            continue;
        }

        let name = caps.name("name").unwrap().as_str();
        let args = caps.name("args").unwrap().as_str();
        if args.trim().is_empty() {
            return Err(syntax("empty constraint annotation"));
        }

        if matches!(name, "MinLength" | "MaxLength" | "Min" | "Max") {
            let Some(c) = positional_re().captures(args) else {
                return Err(syntax("expected exactly one positional integer bound"));
            };
            let bound = parse_bound(c.get(1).unwrap().as_str())?;
            let is_length = matches!(name, "MinLength" | "MaxLength");
            if is_length && bound < 0 {
                return Err(syntax("negative annotation length"));
            }
            annotations.push(Predicate {
                property: if is_length {
                    Property::Length
                } else {
                    Property::Value
                },
                op: if matches!(name, "MinLength" | "Min") {
                    Op::Gte
                } else {
                    Op::Lte
                },
                bound,
            });
            source = source[consumed..].trim_start();
            continue;
        }

        let mut seen = BTreeSet::new();
        for item in args.split(',') {
            let Some(c) = arg_re().captures(item) else {
                return Err(syntax("invalid or repeated annotation argument"));
            };
            let key = c.get(1).unwrap().as_str();
            if !seen.insert(key.to_string()) {
                return Err(syntax("invalid or repeated annotation argument"));
            }
            let bound = parse_bound(c.get(2).unwrap().as_str())?;
            if matches!(name, "Size" | "Length") && bound < 0 {
                return Err(syntax("negative annotation length"));
            }
            if matches!(name, "Size" | "Range") && key == "eq" {
                return Err(syntax("annotation only supports min and max"));
            }
            let op = match key {
                "min" => Op::Gte,
                "max" => Op::Lte,
                "eq" => Op::Eq,
                _ => unreachable!(),
            };
            annotations.push(Predicate {
                property: if name == "Range" {
                    Property::Value
                } else {
                    Property::Length
                },
                op,
                bound,
            });
        }
        source = source[consumed..].trim_start();
    }

    let (name, base, clause, nominal) = if let Some(c) = decl_re().captures(source) {
        (
            c.get(1).unwrap().as_str(),
            base(c.get(2).unwrap().as_str()).unwrap(),
            c.get(3).map(|m| m.as_str()),
            false,
        )
    } else if let Some(c) = newtype_re().captures(source) {
        (
            c.get(1).unwrap().as_str(),
            base(c.get(2).unwrap().as_str()).unwrap(),
            c.get(3).map(|m| m.as_str()),
            true,
        )
    } else {
        return Err(syntax("unsupported declaration"));
    };

    let mut predicates = annotations;
    let mut char_policy = CharPolicy::Any;
    if let Some(clause) = clause {
        for term in and_re().split(clause.trim()) {
            if let Some(c) = char_policy_re().captures(term) {
                if base != Base::String || char_policy != CharPolicy::Any {
                    return Err(syntax("character policy requires string and must be unique"));
                }
                char_policy = match c.get(1).unwrap().as_str() {
                    "ascii_letters" => CharPolicy::AsciiLetters,
                    "ascii_uppercase" => CharPolicy::AsciiUppercase,
                    "ascii_lowercase" => CharPolicy::AsciiLowercase,
                    "uppercase" => CharPolicy::UnicodeUppercase,
                    "lowercase" => CharPolicy::UnicodeLowercase,
                    "han" => CharPolicy::Han,
                    _ => unreachable!(),
                };
                continue;
            }
            // Two disjoint grammars avoid treating `min0` or
            // `min gte 0` as valid shorthand.
            let (constraint_property, op, bound) =
                if let Some(c) = cmp_re().captures(term) {
                    (
                        property(c.get(1).unwrap().as_str()).unwrap(),
                        op_alias(c.get(2).unwrap().as_str()).unwrap(),
                        parse_bound(c.get(3).unwrap().as_str())?,
                    )
                } else if let Some(c) = short_bound_re().captures(term) {
                    if base != Base::Int {
                        return Err(syntax("min/max shorthand requires integer base"));
                    }
                    (
                        Property::Value,
                        if c.get(1).unwrap().as_str() == "min" { Op::Gte } else { Op::Lte },
                        parse_bound(c.get(2).unwrap().as_str())?,
                    )
                } else if let Some(c) = short_length_re().captures(term) {
                    if base != Base::String {
                        return Err(syntax("min_length/max_length shorthand requires string"));
                    }
                    (
                        Property::Length,
                        if c.get(1).unwrap().as_str() == "min_length" { Op::Gte } else { Op::Lte },
                        parse_bound(c.get(2).unwrap().as_str())?,
                    )
                } else {
                    return Err(syntax("unsupported with expression"));
                };
            predicates.push(Predicate {
                property: constraint_property,
                op,
                bound,
            });
        }
    }

    if predicates.is_empty() && !nominal && char_policy == CharPolicy::Any {
        return Err(syntax("missing refinement"));
    }

    let expected = if base == Base::String {
        Property::Length
    } else {
        Property::Value
    };
    if predicates.iter().any(|p| p.property != expected) {
        return Err(syntax("property incompatible with base type"));
    }

    bounds(&predicates, base)?;

    Ok(Refined {
        name: name.to_string(),
        base,
        nominal,
        predicates,
        char_policy,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(src: &str) -> Refined {
        parse(src).unwrap()
    }

    #[test]
    fn equivalent_annotation_and_with() {
        let a = ok("@Size(min=1, max=32) type A = string;");
        let b = ok("type B = string with length gte 1 and length lte 32;");
        for value in [
            "",
            "a",
            "😀",
            "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        ] {
            assert_eq!(
                a.accepts(Candidate::Str(value)),
                b.accepts(Candidate::Str(value))
            );
        }
    }

    #[test]
    fn length_is_unicode_scalar_count() {
        let r = ok("type Emoji = string with length eq 1;");
        assert!(r.accepts(Candidate::Str("😀")));
        assert!(!r.accepts(Candidate::Str("e\u{301}")));
    }

    #[test]
    fn operator_aliases() {
        for (keyword, symbol, normalized) in [
            ("eq", "==", Op::Eq),
            ("ne", "!=", Op::Ne),
            ("gt", ">", Op::Gt),
            ("gte", ">=", Op::Gte),
            ("lt", "<", Op::Lt),
            ("lte", "<=", Op::Lte),
        ] {
            let a = ok(&format!("type A = int with value {keyword} 10;"));
            let b = ok(&format!("type B = int with value {symbol} 10;"));
            assert_eq!(a.predicates[0].op, normalized);
            assert_eq!(b.predicates[0].op, normalized);
        }
    }

    #[test]
    fn implication_and_nominal_distinction() {
        let exact = ok("type A = string with length eq 10;");
        let nonempty = ok("type B = string with length gt 0;");
        assert!(exact.entails(&nonempty));
        assert!(!nonempty.entails(&exact));

        let n = ok("define newtype A(string) with length gt 0;");
        let a = ok("type B = string with length gt 0;");
        assert!(n.nominal);
        assert!(!n.entails(&a));
        assert!(!a.entails(&n));
    }

    #[test]
    fn rejects_unsafe_or_unknown() {
        for source in [
            "type A = string with length gt 0 or length eq 10;",
            "type A = string with length gt foo();",
            "type A = string with length gt 10 and length lt 5;",
            "type A = string with length lt 0;",
            "type A = int with length gt 0;",
            "type A = string where it.trim().length > 0;",
            "@Size(min=1,min=2) type A = string;",
            "@Unknown type A = string;",
            "type A = string with length eq 3.5;",
            "type A = int with value ge 1;",
            "type A = int with value le 10;",
            "type A = string;",
        ] {
            assert!(parse(source).is_err(), "accepted {source}");
        }
    }

    #[test]
    fn bare_nominal_newtype_is_valid_but_empty_alias_is_not() {
        let string = ok("define newtype Name(string);");
        let int = ok("define newtype Number(int);");
        assert!(string.nominal && int.nominal);
        assert!(string.accepts(Candidate::Str("")));
        assert!(string.accepts(Candidate::Str("😀")));
        assert!(int.accepts(Candidate::Int(MIN_I64)));
        assert!(!int.accepts(Candidate::Int(MAX_I64 + 1)));
        assert!(parse("type Missing = string;").is_err());
    }

    #[test]
    fn stdlib_annotation_normalization() {
        let cases: [(&str, &str, &[Candidate<'_>]); 4] = [
            (
                "@MinLength(3) @MaxLength(32) type Username = string;",
                "type Username = string with length gte 3 and length lte 32;",
                &[
                    Candidate::Str(""),
                    Candidate::Str("ab"),
                    Candidate::Str("abc"),
                    Candidate::Str("😀😀😀"),
                    Candidate::Str("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
                    Candidate::Str("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
                ],
            ),
            (
                "@Min(1) @Max(65535) type Port = int;",
                "type Port = int with value >= 1 and value <= 65535;",
                &[
                    Candidate::Int(0),
                    Candidate::Int(1),
                    Candidate::Int(443),
                    Candidate::Int(65535),
                    Candidate::Int(65536),
                ],
            ),
            (
                "@Range(min=0,max=100) type Percentage = int;",
                "type Percentage = int with value gte 0 and value lte 100;",
                &[
                    Candidate::Int(-1),
                    Candidate::Int(0),
                    Candidate::Int(50),
                    Candidate::Int(100),
                    Candidate::Int(101),
                ],
            ),
            (
                "@Range(min=-10,max=10) type Signed = int;",
                "type Signed = int with value >= -10 and value <= 10;",
                &[
                    Candidate::Int(-11),
                    Candidate::Int(-10),
                    Candidate::Int(0),
                    Candidate::Int(10),
                    Candidate::Int(11),
                ],
            ),
        ];
        for (annotations, source, values) in cases {
            let first = ok(annotations);
            let second = ok(source);
            assert_eq!(first.predicates, second.predicates);
            for &value in values {
                assert_eq!(first.accepts(value), second.accepts(value));
            }
        }
    }

    #[test]
    fn bad_stdlib_annotations_reject() {
        for source in [
            "@MinLength(1) type Wrong = int;",
            "@Min(1) type Wrong = string;",
            "@Range(min=1,max=2) type Wrong = string;",
            "@Range(min=1,min=2) type Wrong = int;",
            "@Range(eq=10) type Wrong = int;",
            "@MinLength(-1) type Wrong = string;",
            "@Size(min=-1) type Wrong = string;",
            "@MaxLength(1,2) type Wrong = string;",
            "@Min(foo) type Wrong = int;",
            "@Range() type Wrong = int;",
            "@Min(11) @Max(10) type Wrong = int;",
        ] {
            assert!(parse(source).is_err(), "accepted {source}");
        }
    }

    #[test]
    fn signed_i64_limits() {
        let minimum = ok("type Min = int with value eq -9223372036854775808;");
        assert!(minimum.accepts(Candidate::Int(MIN_I64)));
        assert!(!minimum.accepts(Candidate::Int(MIN_I64 - 1)));
        let maximum = ok("type Max = int with value eq 9223372036854775807;");
        assert!(maximum.accepts(Candidate::Int(MAX_I64)));
        assert!(!maximum.accepts(Candidate::Int(MAX_I64 + 1)));
        for source in [
            "type Bad = int with value eq -9223372036854775809;",
            "type Bad = int with value eq 9223372036854775808;",
            "type Bad = string with length eq 9223372036854775808;",
            "type Bad = int with value lt -9223372036854775808;",
        ] {
            assert!(parse(source).is_err(), "accepted {source}");
        }
    }

    #[test]
    fn exclusions_cannot_exhaust_integer_domain() {
        for source in [
            "type Empty = int with value gte 1 and value lte 2 and value ne 1 and value ne 2;",
            "type Empty = int with value gte -9223372036854775808 and value lte -9223372036854775807 and value ne -9223372036854775808 and value ne -9223372036854775807;",
        ] {
            assert!(parse(source).is_err(), "accepted {source}");
        }
    }

    #[test]
    fn nominal_identity_is_not_erased() {
        let narrow = ok("define newtype Name(string) with length eq 10;");
        let weak = ok("define newtype Name(string) with length gt 0;");
        let other = ok("define newtype Other(string) with length gt 0;");
        let alias = ok("type Alias = string with length gt 0;");
        assert!(narrow.entails(&weak));
        assert!(!weak.entails(&narrow));
        assert!(!narrow.entails(&other));
        assert!(!narrow.entails(&alias));
        assert!(!alias.entails(&narrow));
    }

    #[test]
    fn numeric_shorthand_normalizes_exactly_to_zorde_value_interval() {
        let sugar = ok("define type Code = int with min 0 and max 5;");
        let canonical = ok("type Code = int with value gte 0 and value lte 5;");
        let annotation = ok("@Range(min=0,max=5) type Code = int;");
        assert_eq!(sugar.predicates, canonical.predicates);
        assert_eq!(sugar.predicates, annotation.predicates);
        for n in [-1, 0, 1, 4, 5, 6] {
            assert_eq!(sugar.accepts(Candidate::Int(n)), (0..=5).contains(&n));
        }
        assert!(!sugar.accepts(Candidate::Bool(true)));

        let old = ok("type Positive = int with value gt 0;");
        let positive = ok("define pub type Positive = int with value gt 0;");
        assert_eq!(old.predicates, positive.predicates);
        let legacy = ok("pub define type Positive = int with min 1;");
        assert_eq!(legacy.predicates, ok("type Positive = int with value gte 1;").predicates);
    }

    #[test]
    fn shorthand_must_not_disable_refinement_validation() {
        for source in [
            "type Negative = int with min 10 and max 5;",
            "define type Negative = int with min 5 and max 4;",
            "type No = string with min 1 and max 5;",
            "type No = int with min gte 0;",
            "type No = int with max <= 5;",
            "type No = int with min x;",
            "type No = int with min0;",
            "type No = int with min gte 0;",
            "type No = int with min 0 or max 5;",
            "type No = int with min 0; trailing",
            "type No = int with min -9223372036854775809;",
            "define type No = int as positive integer;",
        ] {
            assert!(parse(source).is_err(), "accepted invalid refinement: {source}");
        }
    }

    #[test]
    fn string_length_and_ascii_character_policies() {
        let equivalent = ok("type A = string with min_length 2 and max_length 4 and chars ascii_letters;");
        let canonical = ok("type A = string with length gte 2 and length lte 4 and chars ascii_letters;");
        assert_eq!(equivalent, canonical);
        for (candidate, accepted) in [
            ("AB", true), ("aBc", true), ("ABCd", true),
            ("A", false), ("ABCDE", false), ("A1", false),
            ("éA", false), ("你好", false), ("😀A", false),
        ] {
            assert_eq!(equivalent.accepts(Candidate::Str(candidate)), accepted, "{candidate:?}");
        }
        let upper = ok("type U = string with chars ascii_uppercase;");
        let lower = ok("type L = string with chars ascii_lowercase;");
        assert!(upper.accepts(Candidate::Str("ABC")));
        assert!(!upper.accepts(Candidate::Str("ABc")));
        assert!(lower.accepts(Candidate::Str("abc")));
        assert!(!lower.accepts(Candidate::Str("Abc")));
        assert!(!upper.accepts(Candidate::Str("123")));
        assert_eq!(ok("type H = string with chars han;").char_policy, CharPolicy::Han);
        // Han Script property is pinned to UCD 18.0; casing still blocked.
        assert!(ok("type H = string with chars han;").accepts(Candidate::Str("中文")));
        assert!(!ok("type H = string with chars han;").accepts(Candidate::Str("中A")));
        assert!(!ok("type H = string with chars han;").accepts(Candidate::Str("😀")));
        assert!(!ok("type H = string with chars uppercase;").accepts(Candidate::Str("ABC")));
    }

    #[test]
    fn ucd18_han_ranges_verify_count_and_boundaries() {
        let source = include_str!("../../../fixtures/refinement-v1/unicode18-han-ranges.csv");
        let manifest: Vec<(u32, u32)> = source
            .lines()
            .filter(|line| !line.starts_with('#') && !line.is_empty())
            .map(|line| {
                let (first, last) = line.split_once(',').expect("canonical Han interval");
                (first.parse().expect("decimal start"), last.parse().expect("decimal end"))
            })
            .collect();
        assert_eq!(manifest, HAN18_RANGES, "runtime must exactly match pinned UCD18 source");
        let total: u32 = HAN18_RANGES.iter().map(|&(a, b)| b - a + 1).sum();
        assert_eq!(HAN18_RANGES.len(), 25);
        assert_eq!(total, 103352);
        for (index, &(first, last)) in HAN18_RANGES.iter().enumerate() {
            assert!(first <= last);
            if index > 0 { assert!(HAN18_RANGES[index - 1].1 < first); }
            assert!(ucd18_han(first), "{first:X}");
            assert!(ucd18_han(last), "{last:X}");
        }
        for scalar in [0x3006, 0x2A6E0, 0x3347A, 0x0041, 0x1F600] {
            assert!(!ucd18_han(scalar), "{scalar:X} must be excluded");
        }
        for scalar in [0x3005, 0x4E2D, 0x20000, 0x33479] {
            assert!(ucd18_han(scalar), "{scalar:X} must be included");
        }
    }

    #[test]
    fn string_policy_invalid_syntax_rejected() {
        for source in [
            "type Bad = int with chars ascii_letters;",
            "type Bad = int with min_length 1;",
            "type Bad = string with min_length 5 and max_length 4;",
            "type Bad = string with chars ascii_letters and chars han;",
            "type Bad = string with chars letters;",
            "type Bad = string with chars [A-Z];",
            "type Bad = string with min_length -1;",
            "type Bad = string with chars ascii_letters or chars han;",
        ] {
            assert!(parse(source).is_err(), "accepted {source}");
        }
    }

    #[test]
    fn signed_bounds_underscores_and_numeric_values() {
        let a = ok("type A = int with value gte -9_223_372_036_854_775_808;");
        assert!(a.accepts(Candidate::Int(MIN_I64)));
        assert!(parse("type Bad = int with value gte 1__0;").is_err());

        let percentage_keyword = ok("type Percentage = int with value gte 0 and value lte 100;");
        let percentage_symbols = ok("type Percentage = int with value >= 0 and value <= 100;");
        for value in [-1, 0, 50, 100, 101] {
            assert_eq!(
                percentage_keyword.accepts(Candidate::Int(value)),
                percentage_symbols.accepts(Candidate::Int(value))
            );
        }
        assert!(!percentage_keyword.accepts(Candidate::Bool(true)));

        let port_keyword = ok("type Port = int with value gte 1 and value lte 65535;");
        let port_symbols = ok("type Port = int with value >= 1 and value <= 65535;");
        for value in [0, 1, 443, 65535, 65536] {
            assert_eq!(
                port_keyword.accepts(Candidate::Int(value)),
                port_symbols.accepts(Candidate::Int(value))
            );
        }
    }

    #[test]
    fn not_empty_and_length_eq_annotations_work() {
        let nonempty = ok("@NotEmpty type Name = string;");
        assert!(!nonempty.accepts(Candidate::Str("")));
        assert!(nonempty.accepts(Candidate::Str("x")));

        let exact = ok("@Length(eq=3) type Code = string;");
        assert!(exact.accepts(Candidate::Str("abc")));
        assert!(!exact.accepts(Candidate::Str("ab")));
        assert!(parse("@Size(eq=3) type Bad = string;").is_err());
    }
}
