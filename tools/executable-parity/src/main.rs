use std::{
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const CASES: &[(&str, Option<&[u8]>)] = &[
    ("scalar-fnc", Some(b"")),
    ("scalar", Some(b"")),
    ("imported-foo", Some(b"hello world\nhiiii 2hiiii")),
    ("invalid", None),
];

struct ResultLog {
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
}

fn run(command: &mut Command, directory: &Path, stage: &str) -> ResultLog {
    fs::write(
        directory.join(format!("{stage}.command")),
        format!("{command:?}\n"),
    )
    .unwrap();
    let out = directory.join(format!("{stage}.stdout"));
    let err = directory.join(format!("{stage}.stderr"));
    // The native strict-NIO console intentionally rejects regular-file stdout.
    // Drain pipes concurrently, then persist captured bytes after execution.
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("launch tool");
    fn drain(mut stream: impl Read) -> (Vec<u8>, bool) {
        const LIMIT: usize = 8 * 1024 * 1024;
        let mut bytes = Vec::new();
        let mut exceeded = false;
        let mut chunk = [0; 8192];
        loop {
            let n = stream.read(&mut chunk).unwrap();
            if n == 0 {
                break;
            }
            let keep = n.min(LIMIT - bytes.len());
            bytes.extend_from_slice(&chunk[..keep]);
            exceeded |= keep != n;
        }
        (bytes, exceeded)
    }
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let stdout = thread::spawn(move || drain(stdout));
    let stderr = thread::spawn(move || drain(stderr));
    let start = Instant::now();
    let (code, timed_out) = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break (status.code(), false);
        }
        if start.elapsed() > Duration::from_secs(120) {
            child.kill().unwrap();
            child.wait().unwrap();
            break (None, true);
        }
        thread::sleep(Duration::from_millis(20));
    };
    let (stdout, stdout_exceeded) = stdout.join().unwrap();
    let (stderr, stderr_exceeded) = stderr.join().unwrap();
    let code = if stdout_exceeded || stderr_exceeded {
        None
    } else {
        code
    };
    fs::write(&out, &stdout).unwrap();
    fs::write(&err, &stderr).unwrap();
    fs::write(
        directory.join(format!("{stage}.status")),
        format!("code={code:?}\ntimed_out={timed_out}\n"),
    )
    .unwrap();
    ResultLog {
        code,
        stdout: fs::read(out).unwrap(),
        stderr: fs::read(err).unwrap(),
        timed_out,
    }
}

fn capture(command: &mut Command) -> String {
    let output = command.output().expect("provenance tool");
    assert!(output.status.success(), "provenance failed: {command:?}");
    String::from_utf8(output.stdout).unwrap()
}

fn identity(root: &Path) -> String {
    let mut result =
        capture(
            Command::new("git")
                .arg("-C")
                .arg(root)
                .args(["rev-parse", "HEAD", "HEAD^{tree}"]),
        );
    result.push_str(&capture(Command::new("git").arg("-C").arg(root).args([
        "status",
        "--porcelain",
        "--untracked-files=no",
    ])));
    result
}

fn hash(path: &Path) -> String {
    capture(Command::new("shasum").args(["-a", "256"]).arg(path))
}

fn main() {
    let args: Vec<_> = env::args_os().skip(1).map(PathBuf::from).collect();
    assert_eq!(args.len(), 7, "usage: atto-executable-parity JAVA_ROOT LLVM_ROOT NET_ROOT JAVA_BIN DOTNET_BIN CLANG_BIN NEW_OUTPUT_DIR");
    let roots: Vec<_> = args[..3]
        .iter()
        .map(|p| fs::canonicalize(p).unwrap())
        .collect();
    let java = fs::canonicalize(&args[3]).unwrap();
    let dotnet = fs::canonicalize(&args[4]).unwrap();
    let clang = fs::canonicalize(&args[5]).unwrap();
    let output = &args[6];
    assert!(!output.exists(), "output directory must be new");
    fs::create_dir_all(output).unwrap();
    let output = fs::canonicalize(output).unwrap();
    let common = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    capture(
        Command::new("shasum")
            .args(["-a", "256", "-c", "SHA256SUMS"])
            .current_dir(common.join("fixtures/executable-three-backend-v1")),
    );
    let compiler = roots[1].join("build/oreslang-llvmc");
    let net_compiler =
        roots[2].join("compiler/Ores.Net.Compiler/bin/Debug/net10.0/osx-arm64/oresnet.dll");
    let classpath = format!(
        "{}:{}",
        roots[0].join("target/classes").display(),
        fs::read_to_string(roots[0].join("target/classpath.txt"))
            .unwrap()
            .trim()
    );
    let identities: Vec<_> = roots.iter().map(|p| identity(p)).collect();
    let mut metadata = fs::File::create(output.join("provenance.txt")).unwrap();
    writeln!(
        metadata,
        "Local execution evidence; no hosted CI or authenticity attestation.\ncommon:\n{}",
        identity(common)
    )
    .unwrap();
    for (i, id) in identities.iter().enumerate() {
        writeln!(metadata, "{}:\n{id}", ["java", "llvm", "net"][i]).unwrap();
        assert_eq!(
            id.lines().count(),
            2,
            "compiler checkout has tracked modifications"
        );
    }
    for binary in [&java, &dotnet, &clang, &compiler, &net_compiler] {
        writeln!(metadata, "{}", hash(binary)).unwrap();
    }
    for dependency in classpath.split(':').skip(1) {
        writeln!(metadata, "java dependency: {}", hash(Path::new(dependency))).unwrap();
    }
    for entry in fs::read_dir(net_compiler.parent().unwrap()).unwrap() {
        let path = entry.unwrap().path();
        if path.is_file()
            && matches!(
                path.extension().and_then(|p| p.to_str()),
                Some("dll" | "json")
            )
        {
            writeln!(metadata, "net dependency: {}", hash(&path)).unwrap();
        }
    }
    for file in [
        "NativeStringRegion.c",
        "NativeIntArrayRegion.c",
        "NativeRecordRegion.c",
    ] {
        writeln!(
            metadata,
            "llvm runtime: {}",
            hash(&roots[1].join("src/main/cpp/oreslang/runtime").join(file))
        )
        .unwrap();
    }
    // Java classes are build products: record their actual bytes, not just Git HEAD.
    let mut classes = Vec::new();
    fn walk(path: &Path, files: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(path).unwrap() {
            let p = entry.unwrap().path();
            if p.is_dir() {
                walk(&p, files);
            } else {
                files.push(p);
            }
        }
    }
    walk(&roots[0].join("target/classes"), &mut classes);
    classes.sort();
    let mut class_hashes = fs::File::create(output.join("java-build-sha256.txt")).unwrap();
    for path in classes {
        write!(class_hashes, "{}", hash(&path)).unwrap();
    }
    writeln!(metadata, "classpath:\n{classpath}").unwrap();
    let mut report = fs::File::create(output.join("results.tsv")).unwrap();
    writeln!(report, "case\tbackend\tresult\texecution_kind").unwrap();
    let mut failures = 0;
    for &(case, expected) in CASES {
        let source_dir = common
            .join("fixtures/executable-three-backend-v1")
            .join(case);
        let snapshot = output.join("sources").join(case);
        fs::create_dir_all(&snapshot).unwrap();
        for entry in fs::read_dir(&source_dir).unwrap() {
            let entry = entry.unwrap();
            assert!(entry.file_type().unwrap().is_file());
            let dest = snapshot.join(entry.file_name());
            fs::copy(entry.path(), &dest).unwrap();
            writeln!(metadata, "fixture: {}", hash(&dest)).unwrap();
            writeln!(
                metadata,
                "fixture Git blob: {}",
                capture(Command::new("git").arg("hash-object").arg(&dest))
            )
            .unwrap();
        }
        let source = snapshot.join("main.atto");
        for backend in ["java", "llvm", "net"] {
            let dir = output.join(case).join(backend);
            fs::create_dir_all(&dir).unwrap();
            let compiled = match backend {
                "java" => run(
                    Command::new(&java)
                        .args([
                            "--enable-native-access=ALL-UNNAMED",
                            "-Dpolyglot.engine.WarnInterpreterOnly=false",
                            "-cp",
                        ])
                        .arg(&classpath)
                        .args(["dev.oreslang.launcher.OresMain", "--check"])
                        .arg(&source),
                    &dir,
                    "compile",
                ),
                "llvm" => run(Command::new(&compiler).arg(&source), &dir, "compile"),
                _ => {
                    let mut cmd = Command::new(&dotnet);
                    cmd.arg(&net_compiler);
                    if case == "imported-foo" {
                        cmd.arg("compile-modules")
                            .arg(&source)
                            .arg("--root")
                            .arg(&snapshot);
                    } else {
                        cmd.arg("compile-structured").arg(&source);
                    }
                    run(
                        cmd.arg("--out").arg(dir.join("OresGenerated.dll")),
                        &dir,
                        "compile",
                    )
                }
            };
            let result = if compiled.timed_out || compiled.code.is_none() {
                "COMPILE_ERROR"
            } else if expected.is_none() {
                if compiled.code != Some(0)
                    && !compiled.stderr.is_empty()
                    && (backend != "llvm" || compiled.stdout.is_empty())
                    && !dir.join("OresGenerated.dll").exists()
                {
                    "PASS_REJECTION"
                } else {
                    "FAIL_REJECTION"
                }
            } else if compiled.code != Some(0) {
                "GAP_REJECTED"
            } else {
                let executable = match backend {
                    "java" => Some(run(
                        Command::new(&java)
                            .args([
                                "--enable-native-access=ALL-UNNAMED",
                                "-Dpolyglot.engine.WarnInterpreterOnly=false",
                                "-cp",
                            ])
                            .arg(&classpath)
                            .arg("dev.oreslang.launcher.OresMain")
                            .arg(&source),
                        &dir,
                        "execute",
                    )),
                    "llvm" => {
                        let ir = dir.join("program.ll");
                        fs::write(&ir, &compiled.stdout).unwrap();
                        let runtime = roots[1].join("src/main/cpp/oreslang/runtime");
                        let linked = run(
                            Command::new(&clang)
                                .args(["-O2", "-x", "ir"])
                                .arg(ir)
                                .args(["-x", "c", "-std=c11", "-I"])
                                .arg(roots[1].join("src/main/cpp"))
                                .arg(runtime.join("NativeStringRegion.c"))
                                .arg(runtime.join("NativeIntArrayRegion.c"))
                                .arg(runtime.join("NativeRecordRegion.c"))
                                .args(["-pthread", "-o"])
                                .arg(dir.join("program")),
                            &dir,
                            "link",
                        );
                        if linked.code == Some(0) {
                            Some(run(&mut Command::new(dir.join("program")), &dir, "execute"))
                        } else {
                            None
                        }
                    }
                    _ => {
                        let built =
                            run(
                                Command::new(&dotnet)
                                    .arg("build")
                                    .arg(common.join(
                                        "tools/executable-parity/net-launcher/Launcher.csproj",
                                    ))
                                    .arg(format!(
                                        "-p:GuestAssembly={}",
                                        dir.join("OresGenerated.dll").display()
                                    ))
                                    .arg(format!(
                                        "-p:BaseIntermediateOutputPath={}/obj/",
                                        dir.display()
                                    ))
                                    .arg("--output")
                                    .arg(dir.join("launcher")),
                                &dir,
                                "link",
                            );
                        if built.code == Some(0) {
                            Some(run(
                                Command::new(&dotnet).arg(dir.join("launcher/Launcher.dll")),
                                &dir,
                                "execute",
                            ))
                        } else {
                            None
                        }
                    }
                };
                match executable {
                    Some(r)
                        if !r.timed_out && r.code == Some(0) && r.stdout == expected.unwrap() =>
                    {
                        "PASS_EXECUTED"
                    }
                    Some(_) => "FAIL_EXECUTION",
                    None => "FAIL_LINK",
                }
            };
            if !result.starts_with("PASS_") {
                failures += 1;
            }
            let kind = match backend {
                "java" => "jvm",
                "llvm" => "native-o2",
                _ => "managed-cil",
            };
            writeln!(report, "{case}\t{backend}\t{result}\t{kind}").unwrap();
            println!("{case:14} {backend:5} {result}");
        }
        // All backends must have received identical source bytes, including imports.
        for entry in fs::read_dir(&snapshot).unwrap() {
            let entry = entry.unwrap();
            assert_eq!(
                fs::read(entry.path()).unwrap(),
                fs::read(source_dir.join(entry.file_name())).unwrap()
            );
        }
    }
    assert_eq!(
        roots.iter().map(|p| identity(p)).collect::<Vec<_>>(),
        identities,
        "compiler source changed during run"
    );
    if failures > 0 {
        std::process::exit(1);
    }
}
