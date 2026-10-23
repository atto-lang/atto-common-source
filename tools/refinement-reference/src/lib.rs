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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refined {
    pub name: String,
    pub base: Base,
    pub nominal: bool,
    pub predicates: Vec<Predicate>,
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
    }

    pub fn entails(&self, other: &Self) -> bool {
        if self.base != other.base {
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
fn decl_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?s)^\s*type\s+([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(string|int)\s*(?:with\s+(.+))?\s*;\s*$").unwrap())
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
    if let Some(clause) = clause {
        for term in and_re().split(clause.trim()) {
            let Some(c) = cmp_re().captures(term) else {
                return Err(syntax("unsupported with expression"));
            };
            predicates.push(Predicate {
                property: property(c.get(1).unwrap().as_str()).unwrap(),
                op: op_alias(c.get(2).unwrap().as_str()).unwrap(),
                bound: parse_bound(c.get(3).unwrap().as_str())?,
            });
        }
    }

    if predicates.is_empty() && !nominal {
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
