fn main() {
    tauri_build::build();

    // Cargo test binaries do not inherit application manifests from tauri-build.
    // When tao's windowing code is reachable from tests, it imports comctl32!TaskDialogIndirect,
    // which is only exported by comctl32 v6. Without this dependency, Windows defaults to
    // comctl32 v5.82 and fails to launch test binaries with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139).
    // Using /MANIFESTDEPENDENCY avoids duplicate resource collisions with tauri-build's manifest.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
}
