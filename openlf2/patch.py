"""Make OpenLF2 find an LF2 installer shipped inside the iOS app bundle (full offline build)."""
import sys, pathlib, subprocess

root = pathlib.Path(sys.argv[1])
# KB button (system keyboard straight into the game) and MV button (one-tap special moves panel)
patch = pathlib.Path(__file__).with_name("touch-moves-keyboard.patch")
subprocess.run(["git", "apply", "--whitespace=nowarn", str(patch.resolve())], cwd=root, check=True)
print("applied", patch.name)
src = root / "src/app/application.cpp"
s = src.read_text()

helper = r'''
#if defined(__APPLE__)
#include <mach-o/dyld.h>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <system_error>
namespace {
// Full build: LF2_v2.0a.exe (or lf2_v20a_Setup.exe) is shipped next to the executable in the app bundle.
std::optional<std::filesystem::path> openlf2_bundled_installer() {
    char buffer[4096];
    std::uint32_t size = sizeof(buffer);
    if (_NSGetExecutablePath(buffer, &size) != 0) return std::nullopt;
    const auto dir = std::filesystem::path(buffer).parent_path();
    for (const char* name : {"LF2_v2.0a.exe", "lf2_v20a_Setup.exe"}) {
        std::error_code error;
        auto candidate = dir / name;
        if (std::filesystem::is_regular_file(candidate, error)) return candidate;
    }
    return std::nullopt;
}
}
#endif
'''

anchor = "    auto found = find_installer(directory);\n    if (!found || *found) return found;\n"
if anchor not in s:
    sys.exit("patch.py: anchor not found in application.cpp (OpenLF2 changed)")
s = s.replace(anchor, anchor + "#if defined(__APPLE__)\n    if (auto bundled = openlf2_bundled_installer()) return std::optional{*bundled};\n#endif\n", 1)

# put the helper just before the engine's own namespace (outside any #ifdef)
marker = "\nnamespace openlf2 {\n"
if marker not in s:
    sys.exit("patch.py: namespace marker not found")
s = s.replace(marker, "\n" + helper + marker, 1)
src.write_text(s)
print("patched", src)

# --- Android: same patched scripts as iOS, and the bundled installer staged from the APK ---
# Cross-play iPhone <-> Android: the network handshake compares a digest of the scripts plus the JIT
# setting. iOS cannot JIT, so Android is built with the interpreter too; then both digests match.
cmake = root / "CMakeLists.txt"
c = cmake.read_text()
jit_old = "if(ANDROID OR CMAKE_SYSTEM_NAME STREQUAL \"Linux\""
if jit_old not in c:
    sys.exit("patch.py: JIT condition not found in CMakeLists.txt")
cmake.write_text(c.replace(jit_old, "if(CMAKE_SYSTEM_NAME STREQUAL \"Linux\"", 1))
print("patched", cmake)

activity = root / "android/app/src/main/java/io/github/openlf2/openlf2/OpenLF2Activity.java"
a = activity.read_text()
call_old = "    protected void onCreate(Bundle savedInstanceState) {\n"
if call_old not in a:
    sys.exit("patch.py: onCreate not found in OpenLF2Activity.java")
a = a.replace(call_old, call_old + "        stageBundledInstaller();\n", 1)
method = """
    /** Full build: copies the LF2 v2.0a installer shipped in the APK assets next to the settings, once. */
    private void stageBundledInstaller() {
        try {
            String[] names = getAssets().list("");
            if (names == null) return;
            for (String name : names) {
                if (!name.equals("LF2_v2.0a.exe") && !name.equals("lf2_v20a_Setup.exe")) continue;
                File target = new File(getFilesDir(), name);
                if (target.isFile() && target.length() > 0) continue;
                File partial = new File(getFilesDir(), name + ".part");
                try (InputStream source = getAssets().open(name);
                     OutputStream output = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = source.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                if (!partial.renameTo(target)) partial.delete();
            }
        } catch (IOException error) {
            Log.w(TAG, "Could not stage the bundled LF2 installer", error);
        }
    }
"""
anchor = "    private void copyAssetTree("
if anchor not in a:
    sys.exit("patch.py: copyAssetTree not found")
activity.write_text(a.replace(anchor, method + "\n" + anchor, 1))
print("patched", activity)

